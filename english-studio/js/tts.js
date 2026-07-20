/**
 * tts.js — text-to-speech with IndexedDB caching.
 *
 * Engines: "kokoro" (local, default) | "openai" | "elevenlabs".
 * Audio is always synthesized at 1.0× speed — playback speed is applied via
 * the <audio> element's playbackRate so cached audio is reusable at any speed.
 */

import { sha1 } from "./common.js";
import { dbGet, dbPut } from "./audio-cache.js";

const KOKORO_TTS_URL =
  window.KOKORO_TTS_URL || "http://localhost:8880/v1/audio/speech";
const KOKORO_TTS_MODEL = window.KOKORO_TTS_MODEL || "kokoro";
const KOKORO_VOICE = window.KOKORO_VOICE || "af_heart";
const OPENAI_KEY = window.OPENAI_API_KEY || "";
const OPENAI_TTS_VOICE = window.OPENAI_TTS_VOICE || "alloy";
const EL_API_KEY = window.ELEVENLABS_API_KEY || "";
const EL_VOICE_ID = window.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";

const CHAR_LIMIT = 4000;

export const DEFAULT_ENGINE = window.TTS_ENGINE || "kokoro";

function engineVoice(engine) {
  if (engine === "openai") return OPENAI_TTS_VOICE;
  if (engine === "elevenlabs") return EL_VOICE_ID;
  return KOKORO_VOICE;
}

// ── Fetchers ──────────────────────────────────────────────────────
async function fetchKokoro(text) {
  const resp = await fetch(KOKORO_TTS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: KOKORO_TTS_MODEL,
      input: text,
      voice: KOKORO_VOICE,
      response_format: "mp3",
      speed: 1.0,
    }),
  });
  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText);
    throw new Error(`Kokoro TTS ${resp.status}: ${msg}`);
  }
  return resp.blob();
}

async function fetchOpenAi(text) {
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY not set in config.local.js");
  const resp = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "tts-1",
      voice: OPENAI_TTS_VOICE,
      input: text,
      speed: 1.0,
    }),
  });
  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText);
    throw new Error(`OpenAI TTS ${resp.status}: ${msg}`);
  }
  return resp.blob();
}

async function fetchElevenLabs(text) {
  if (!EL_API_KEY)
    throw new Error("ELEVENLABS_API_KEY not set in config.local.js");
  const resp = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${EL_VOICE_ID}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": EL_API_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    },
  );
  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText);
    throw new Error(`ElevenLabs ${resp.status}: ${msg}`);
  }
  return resp.blob();
}

async function fetchEngine(engine, text) {
  if (engine === "openai") return fetchOpenAi(text);
  if (engine === "elevenlabs") return fetchElevenLabs(text);
  return fetchKokoro(text);
}

// ── Long-text splitting / merging ─────────────────────────────────
function splitTextChunks(text, limit) {
  if (text.length <= limit) return [text];
  const chunks = [];
  const sentences = text.match(/[^.!?\n]+[.!?\n]*/g) || [text];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).length > limit) {
      if (cur) {
        chunks.push(cur.trim());
        cur = "";
      }
      if (s.length > limit) {
        for (const w of s.split(/\s+/)) {
          if ((cur + " " + w).trim().length > limit) {
            if (cur) chunks.push(cur.trim());
            cur = w;
          } else {
            cur = cur ? cur + " " + w : w;
          }
        }
      } else {
        cur = s;
      }
    } else {
      cur += s;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

export async function mergeBlobs(blobs) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) throw new Error("AudioContext not supported");
  const ctx = new AC();
  const decoded = await Promise.all(
    blobs.map(async (b) => ctx.decodeAudioData(await b.arrayBuffer())),
  );
  ctx.close();
  const sr = decoded[0].sampleRate;
  const total = decoded.reduce((s, b) => s + b.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const b of decoded) {
    out.set(b.getChannelData(0), off);
    off += b.length;
  }
  const ab = new ArrayBuffer(44 + out.length * 2);
  const vw = new DataView(ab);
  const w = (o, x) => vw.setUint32(o, x, true);
  const ws = (o, x) => vw.setUint16(o, x, true);
  w(0, 0x46464952);
  w(4, 36 + out.length * 2);
  w(8, 0x45564157);
  w(12, 0x20746d66);
  w(16, 16);
  ws(20, 1);
  ws(22, 1);
  w(24, sr);
  w(28, sr * 2);
  ws(32, 2);
  ws(34, 16);
  w(36, 0x61746164);
  w(40, out.length * 2);
  for (let i = 0; i < out.length; i++) {
    const s = Math.max(-1, Math.min(1, out[i]));
    vw.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([ab], { type: "audio/wav" });
}

// ── Public API ────────────────────────────────────────────────────
async function cacheKey(engine, text) {
  return `${engine}|${engineVoice(engine)}|${await sha1(text)}`;
}

const inflight = new Map(); // cacheKey → Promise<Blob>

/**
 * Synthesize `text` with `engine`, using the IndexedDB cache.
 * Returns a Blob. Concurrent calls for the same text share one request.
 */
export async function synthesize(text, engine = DEFAULT_ENGINE) {
  const key = await cacheKey(engine, text);
  const cached = await dbGet(key, "audio");
  if (cached) return new Blob([cached.buf], { type: cached.mime });

  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    const chunks = splitTextChunks(text, CHAR_LIMIT);
    let blob;
    if (chunks.length === 1) {
      blob = await fetchEngine(engine, chunks[0]);
    } else {
      const blobs = [];
      for (const c of chunks) blobs.push(await fetchEngine(engine, c));
      blob = await mergeBlobs(blobs);
    }
    await dbPut(
      key,
      { buf: await blob.arrayBuffer(), mime: blob.type || "audio/mpeg", ts: Date.now() },
      "audio",
    );
    return blob;
  })();
  inflight.set(key, p);
  try {
    return await p;
  } finally {
    inflight.delete(key);
  }
}

/** Is this text already cached for the engine? */
export async function isCached(text, engine = DEFAULT_ENGINE) {
  return !!(await dbGet(await cacheKey(engine, text), "audio"));
}
