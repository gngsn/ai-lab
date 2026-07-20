/**
 * stt.js — speech-to-text engines.
 *
 * "vibevoice" (local MLX server, default) → falls back to "webspeech"
 * automatically when the server is unreachable. "whisper" uses OpenAI.
 * WebSpeech (live recognition) is driven by the page, not here.
 */

const OPENAI_KEY = window.OPENAI_API_KEY || "";
const MLX_STT_URL =
  window.MLX_STT_URL || "http://localhost:8000/v1/audio/transcriptions";
const MLX_STT_MODEL =
  window.MLX_STT_MODEL || "mlx-community/VibeVoice-ASR-4bit";

export const STT_ENGINE = window.STT_ENGINE || "vibevoice";

export async function whisperTranscribe(blob) {
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY not set");
  const fd = new FormData();
  fd.append("file", blob, "rec.webm");
  fd.append("model", "whisper-1");
  fd.append("language", "en");
  const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}` },
    body: fd,
  });
  if (!resp.ok) throw new Error(`Whisper ${resp.status}`);
  return (await resp.json()).text || "";
}

export async function vibevoiceTranscribe(blob) {
  const fd = new FormData();
  fd.append("file", blob, "rec.webm");
  fd.append("model", MLX_STT_MODEL);
  fd.append("language", "en");
  const resp = await fetch(MLX_STT_URL, { method: "POST", body: fd });
  if (!resp.ok) throw new Error(`MLX STT ${resp.status}`);
  return (await resp.json()).text || "";
}

/**
 * Is the local MLX server up? A network failure means "no"; any HTTP
 * response (even an error status) counts as reachable.
 */
export async function mlxReachable() {
  const base = MLX_STT_URL.replace(/\/v1\/.*$/, "");
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    await fetch(`${base}/v1/models`, { signal: ctrl.signal });
    clearTimeout(timer);
    return true;
  } catch {
    return false;
  }
}

export async function transcribeBlob(engine, blob) {
  if (engine === "whisper") return whisperTranscribe(blob);
  return vibevoiceTranscribe(blob); // "vibevoice"
}
