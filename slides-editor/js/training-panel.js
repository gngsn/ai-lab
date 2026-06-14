/**
 * training-panel.js — shared English pronunciation training panel.
 *
 * Builds the TTS (Listen/New/Save) + Record/playback/recording-history +
 * scoring-feedback UI into a host-supplied container and owns all of its
 * state per instance. Single source of truth for both pronunciation.html
 * and edit.html.
 *
 *   createTrainingPanel(container, { deckId, getSection, onScore })
 *     → { setSection, setSpeed, setEngine, getEngine, synthesize, destroy }
 *
 * mergeBlobs / silenceWav are exported so the pronunciation deck export can
 * still build a full-deck WAV.
 */

// ── Config ────────────────────────────────────────────────────────
const EL_API_KEY = window.ELEVENLABS_API_KEY || "";
const EL_VOICE_ID = window.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
const STT_ENGINE = window.PRONUNCIATION_STT || "vibevoice";
const OPENAI_KEY = window.OPENAI_API_KEY || "";
// Local MLX speech-to-text (OpenAI-compatible /v1/audio/transcriptions server).
const MLX_STT_URL =
  window.MLX_STT_URL || "http://localhost:8000/v1/audio/transcriptions";
const MLX_STT_MODEL = window.MLX_STT_MODEL || "mlx-community/VibeVoice-ASR-4bit";
// Local Kokoro-82M TTS via an OpenAI-compatible server (e.g. Kokoro-FastAPI).
const KOKORO_TTS_URL =
  window.KOKORO_TTS_URL || "http://localhost:8880/v1/audio/speech";
const KOKORO_TTS_MODEL = window.KOKORO_TTS_MODEL || "kokoro";
const KOKORO_VOICE = window.KOKORO_VOICE || "af_heart";

const OPENAI_TTS_LIMIT = 4000; // leave 96 chars margin
const MAX_HISTORY = 10;

// ── IndexedDB (module-level, shared across instances) ─────────────
let _db = null;
async function getDb() {
  if (_db) return _db;
  return new Promise((res, rej) => {
    const req = indexedDB.open("pronunciation-cache", 3);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("audio")) db.createObjectStore("audio");
      if (!db.objectStoreNames.contains("history"))
        db.createObjectStore("history");
      if (!db.objectStoreNames.contains("recordings"))
        db.createObjectStore("recordings");
    };
    req.onsuccess = (e) => {
      _db = e.target.result;
      res(_db);
    };
    req.onerror = () => rej(req.error);
  });
}
async function dbGet(key, store = "audio") {
  const db = await getDb();
  return new Promise((res, rej) => {
    const req = db.transaction(store, "readonly").objectStore(store).get(key);
    req.onsuccess = () => res(req.result || null);
    req.onerror = () => rej(req.error);
  });
}
async function dbPut(key, val, store = "audio") {
  const db = await getDb();
  return new Promise((res, rej) => {
    const req = db
      .transaction(store, "readwrite")
      .objectStore(store)
      .put(val, key);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
}

async function sha1(text) {
  const buf = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Text helpers (pure, module-level) ─────────────────────────────
export function cleanForSpeech(text) {
  return String(text)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^---\s*$/gm, "")
    .replace(/^\[Next\]\s*/gm, "Next. ")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function levenshtein(a, b) {
  const m = a.length,
    n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

function diffTokens(ref, hyp) {
  const m = ref.length,
    n = hyp.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] =
        ref[i - 1] === hyp[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
  const aligned = [];
  let i = m,
    j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && ref[i - 1] === hyp[j - 1]) {
      aligned.unshift({ word: ref[i - 1], status: "hit" });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      aligned.unshift({ word: hyp[j - 1], status: "extra" });
      j--;
    } else {
      const nearby = hyp.slice(Math.max(0, j - 3), Math.min(n, j + 3));
      const close = nearby.find(
        (w) =>
          levenshtein(ref[i - 1], w) <= Math.ceil(ref[i - 1].length * 0.35),
      );
      aligned.unshift({ word: ref[i - 1], status: close ? "near" : "miss" });
      i--;
    }
  }
  return aligned;
}

function scoreFromDiff(diff) {
  const ref = diff.filter((d) => d.status !== "extra");
  if (!ref.length) return 0;
  const hits = diff.filter((d) => d.status === "hit").length;
  const nears = diff.filter((d) => d.status === "near").length;
  return Math.round(((hits + nears * 0.5) / ref.length) * 100);
}

function scoreClass(s) {
  return s >= 80 ? "great" : s >= 55 ? "ok" : "poor";
}

function renderDiff(diff) {
  return diff
    .map(
      ({ word, status }) => `<span class="${status}">${escapeHtml(word)}</span>`,
    )
    .join(" ");
}

function fmtTime(ts) {
  return new Date(ts).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function engineTag(engine) {
  return engine === "openai" ? "☁️" : engine === "elevenlabs" ? "🎤" : "🏠";
}

function splitTextChunks(text, limit) {
  if (text.length <= limit) return [text];
  const chunks = [];
  // Split on sentence boundaries to keep natural pauses
  const sentences = text.match(/[^.!?\n]+[.!?\n]*/g) || [text];
  let cur = "";
  for (const s of sentences) {
    if ((cur + s).length > limit) {
      if (cur) {
        chunks.push(cur.trim());
        cur = "";
      }
      // Sentence itself exceeds limit — split on whitespace
      if (s.length > limit) {
        const words = s.split(/\s+/);
        for (const w of words) {
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

function safePart(s) {
  return String(s).replace(/[^a-zA-Z0-9가-힣_\-]/g, "_");
}

function fileStamp(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

// ── WAV helpers for export (exported) ─────────────────────────────
export function silenceWav(sec, sr = 22050) {
  const n = Math.floor(sec * sr),
    buf = new ArrayBuffer(44 + n * 2),
    v = new DataView(buf);
  const w = (o, x) => v.setUint32(o, x, true),
    ws = (o, x) => v.setUint16(o, x, true);
  w(0, 0x46464952);
  w(4, 36 + n * 2);
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
  w(40, n * 2);
  return new Blob([buf], { type: "audio/wav" });
}

export async function mergeBlobs(blobs) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) throw new Error("AudioContext not supported");
  const ctx = new AC();
  const decoded = await Promise.all(
    blobs.map(async (b) => ctx.decodeAudioData(await b.arrayBuffer())),
  );
  ctx.close();
  const sr = decoded[0].sampleRate,
    total = decoded.reduce((s, b) => s + b.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const b of decoded) {
    out.set(b.getChannelData(0), off);
    off += b.length;
  }
  // float32 → WAV
  const ab = new ArrayBuffer(44 + out.length * 2),
    vw = new DataView(ab);
  const w = (o, x) => vw.setUint32(o, x, true),
    ws = (o, x) => vw.setUint16(o, x, true);
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

// ── Panel markup ──────────────────────────────────────────────────
const PANEL_HTML = `
  <div id="audio-row">
    <audio id="section-audio" controls></audio>
    <select id="history-select" class="history-select" title="Saved takes (history)" style="display:none"></select>
  </div>
  <div id="action-row">
    <button class="btn" id="listen-btn">🔄 Generate</button>
    <button class="btn" id="save-btn" title="Save the current take into a folder on disk">💾 Save</button>
    <button class="btn" id="record-btn">🎙 Record</button>
    <button class="btn ok" id="retry-btn" style="display:none">↺ Retry</button>
    <span id="stt-status" class="stt-status"></span>
  </div>
  <div id="rec-row">
    <div class="rec-head">
      <span class="rec-label">🎙 Your recording</span>
      <button class="btn" id="rec-save-btn" title="Save recordings to a folder (pick ~/.cleartalk once)">📁 Folder</button>
    </div>
    <audio id="rec-audio" controls></audio>
    <select id="rec-history-select" class="history-select" title="Saved recordings" style="display:none"></select>
  </div>
  <div id="feedback-area">
    <div id="feedback-hint">
      Press <kbd>▶ Listen</kbd> to hear a native-speaker model,<br>
      then <kbd>🎙 Record</kbd> and speak the script.<br>
      Your pronunciation will be scored word-by-word.
    </div>
    <div class="fb-block" id="fb-diff" style="display:none">
      <div class="fb-label">Word comparison</div>
      <div class="diff-text" id="diff-text"></div>
    </div>
    <div class="fb-block" id="fb-score" style="display:none">
      <div class="fb-label">Score</div>
      <div id="score-display">
        <span id="score-big">—</span>
        <span id="score-meta">
          <span id="score-desc"></span>
        </span>
      </div>
    </div>
    <div class="fb-block" id="fb-transcript" style="display:none">
      <div class="fb-label">Transcript</div>
      <div id="transcript-raw"></div>
    </div>
  </div>`;

/**
 * Build the training panel into `container` and return its API.
 *
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {string} opts.deckId   IndexedDB namespace + filename prefix.
 * @param {() => {sectionId,title,text}} [opts.getSection]  live section source.
 * @param {(sectionId, score, cls) => void} [opts.onScore]  score callback.
 */
export function createTrainingPanel(container, { deckId, getSection, onScore }) {
  // ── Per-instance state ──────────────────────────────────────────
  let currentSpeed = 1.0;
  let currentTTSEngine = window.PRONUNCIATION_TTS || "kokoro"; // "kokoro" | "openai" | "elevenlabs"
  let section = { sectionId: null, title: "", text: "" };
  let isRecording = false;
  let speechRec = null; // active SpeechRecognition (webspeech mode)
  let sttParts = []; // webspeech transcript fragments
  let recMediaRecorder = null; // captures the user's voice for replay
  let recStream = null;
  let recChunks = [];
  let recEngine = null; // STT engine used for the current recording
  let outputDirHandle = null;
  let recRootHandle = null;
  const versionUrlCache = new Map(); // version.ts → objectURL
  const recUrlCache = new Map(); // recording.ts → objectURL

  // ── DOM ─────────────────────────────────────────────────────────
  const root = document.createElement("div");
  root.className = "training-panel";
  root.innerHTML = PANEL_HTML;
  container.appendChild(root);
  const q = (id) => root.querySelector(`#${id}`);

  const audioEl = q("section-audio");
  const historySelectEl = q("history-select");
  const recAudioEl = q("rec-audio");
  const recHistorySelectEl = q("rec-history-select");
  const recSaveBtn = q("rec-save-btn");
  const listenBtn = q("listen-btn");
  const saveBtn = q("save-btn");
  const recordBtn = q("record-btn");
  const retryBtn = q("retry-btn");
  const sttStatusEl = q("stt-status");
  const diffEl = q("diff-text");
  const scoreBigEl = q("score-big");
  const scoreDescEl = q("score-desc");
  const transcriptRawEl = q("transcript-raw");
  const feedbackHintEl = q("feedback-hint");
  const feedbackAreaEl = q("feedback-area");

  // ── TTS fetchers ────────────────────────────────────────────────
  async function fetchKokoroAudioChunk(text) {
    const resp = await fetch(KOKORO_TTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: KOKORO_TTS_MODEL,
        input: text,
        voice: KOKORO_VOICE,
        response_format: "mp3",
        speed: currentSpeed,
      }),
    });
    if (!resp.ok) {
      const msg = await resp.text().catch(() => resp.statusText);
      throw new Error(`Kokoro TTS ${resp.status}: ${msg}`);
    }
    return resp.blob();
  }

  async function fetchKokoroAudio(text) {
    const chunks = splitTextChunks(text, OPENAI_TTS_LIMIT);
    if (chunks.length === 1) return fetchKokoroAudioChunk(chunks[0]);
    const blobs = await Promise.all(
      chunks.map((c) => fetchKokoroAudioChunk(c)),
    );
    return mergeBlobs(blobs);
  }

  async function fetchOpenAiAudioChunk(text) {
    if (!OPENAI_KEY)
      throw new Error("OPENAI_API_KEY not set in config.local.js");
    const resp = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1",
        voice: "alloy",
        input: text,
        speed: currentSpeed,
      }),
    });
    if (!resp.ok) {
      const msg = await resp.text().catch(() => resp.statusText);
      throw new Error(`OpenAI TTS ${resp.status}: ${msg}`);
    }
    return resp.blob();
  }

  async function fetchOpenAiAudio(text) {
    const chunks = splitTextChunks(text, OPENAI_TTS_LIMIT);
    if (chunks.length === 1) return fetchOpenAiAudioChunk(chunks[0]);
    const blobs = await Promise.all(
      chunks.map((c) => fetchOpenAiAudioChunk(c)),
    );
    return mergeBlobs(blobs);
  }

  async function fetchElAudio(text) {
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
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            speed: currentSpeed,
          },
        }),
      },
    );
    if (!resp.ok) {
      const msg = await resp.text().catch(() => resp.statusText);
      throw new Error(`ElevenLabs ${resp.status}: ${msg}`);
    }
    return resp.blob();
  }

  async function fetchTTSAudio(text) {
    if (currentTTSEngine === "elevenlabs") return fetchElAudio(text);
    if (currentTTSEngine === "openai") return fetchOpenAiAudio(text);
    // "kokoro" — local Kokoro-82M (default)
    return fetchKokoroAudio(text);
  }

  // ── TTS history (IndexedDB) ─────────────────────────────────────
  function historyKey(sectionId) {
    return `${deckId}/${sectionId}`;
  }
  async function getHistory(sectionId) {
    return (await dbGet(historyKey(sectionId), "history")) || { versions: [] };
  }
  async function saveHistory(sectionId, hist) {
    await dbPut(historyKey(sectionId), hist, "history");
  }
  function versionUrl(v) {
    let url = versionUrlCache.get(v.ts);
    if (!url) {
      url = URL.createObjectURL(
        new Blob([v.buf], { type: v.mime || "audio/mpeg" }),
      );
      versionUrlCache.set(v.ts, url);
    }
    return url;
  }

  // Reuse the latest matching take when text + engine are unchanged;
  // otherwise synthesize once and store it as the new latest take.
  async function getOrCreateVersion(sectionId, cleanText, { forceNew } = {}) {
    const textHash = await sha1(cleanText);
    const hist = await getHistory(sectionId);
    if (!forceNew) {
      const match = hist.versions.find(
        (v) => v.textHash === textHash && v.engine === currentTTSEngine,
      );
      if (match) return { version: match, hist, reused: true };
    }
    const blob = await fetchTTSAudio(cleanText);
    const buf = await blob.arrayBuffer();
    const version = {
      ts: Date.now(),
      engine: currentTTSEngine,
      voice: currentTTSEngine === "kokoro" ? KOKORO_VOICE : "",
      textHash,
      mime: blob.type || "audio/mpeg",
      buf,
    };
    hist.versions.unshift(version);
    if (hist.versions.length > MAX_HISTORY) hist.versions.length = MAX_HISTORY;
    await saveHistory(sectionId, hist);
    return { version, hist, reused: false };
  }

  function showVersion(version, hist) {
    audioEl.src = versionUrl(version);
    audioEl.classList.add("show");
    audioEl.playbackRate = currentSpeed;
    renderHistory(hist, version.ts);
  }
  function renderHistory(hist, activeTs) {
    if (!historySelectEl) return;
    const versions = (hist && hist.versions) || [];
    if (!versions.length) {
      historySelectEl.style.display = "none";
      historySelectEl.innerHTML = "";
      return;
    }
    const n = versions.length;
    historySelectEl.innerHTML = versions
      .map((v, i) => {
        const label = `v${n - i} · ${fmtTime(v.ts)} · ${engineTag(v.engine)}`;
        return `<option value="${v.ts}"${v.ts === activeTs ? " selected" : ""}>${label}</option>`;
      })
      .join("");
    historySelectEl.style.display = "";
  }

  // ── Recording history (the user's own voice, IndexedDB) ─────────
  async function getRecordings(sectionId) {
    return (
      (await dbGet(historyKey(sectionId), "recordings")) || { versions: [] }
    );
  }
  async function saveRecording(sectionId, blob) {
    const buf = await blob.arrayBuffer();
    const hist = await getRecordings(sectionId);
    const version = { ts: Date.now(), mime: blob.type || "audio/webm", buf };
    hist.versions.unshift(version);
    if (hist.versions.length > MAX_HISTORY) hist.versions.length = MAX_HISTORY;
    await dbPut(historyKey(sectionId), hist, "recordings");
    return { version, hist };
  }
  function recUrl(v) {
    let url = recUrlCache.get(v.ts);
    if (!url) {
      url = URL.createObjectURL(
        new Blob([v.buf], { type: v.mime || "audio/webm" }),
      );
      recUrlCache.set(v.ts, url);
    }
    return url;
  }
  function showRecording(version, hist, { autoplay = false } = {}) {
    recAudioEl.src = recUrl(version);
    recAudioEl.classList.add("show");
    renderRecHistory(hist, version.ts);
    if (autoplay) recAudioEl.play().catch(() => {});
  }
  function renderRecHistory(hist, activeTs) {
    if (!recHistorySelectEl) return;
    const versions = (hist && hist.versions) || [];
    if (!versions.length) {
      recHistorySelectEl.style.display = "none";
      recHistorySelectEl.innerHTML = "";
      return;
    }
    const n = versions.length;
    recHistorySelectEl.innerHTML = versions
      .map((v, i) => {
        const label = `take ${n - i} · ${fmtTime(v.ts)}`;
        return `<option value="${v.ts}"${v.ts === activeTs ? " selected" : ""}>${label}</option>`;
      })
      .join("");
    recHistorySelectEl.style.display = "";
  }

  // ── Save TTS take to a folder on disk (File System Access API) ──
  function audioFileName(title, mime) {
    const ext = mime && mime.includes("wav") ? "wav" : "mp3";
    const safe = (title || section.sectionId || "slide")
      .replace(/[^a-zA-Z0-9가-힣_\- ]/g, "_")
      .trim();
    return `${deckId}__${safe}.${ext}`;
  }

  async function verifyPermission(handle) {
    const opts = { mode: "readwrite" };
    if ((await handle.queryPermission(opts)) === "granted") return true;
    return (await handle.requestPermission(opts)) === "granted";
  }

  // Must be called from a user gesture (the Save click) so the folder
  // picker / permission re-grant is allowed.
  async function ensureOutputDir() {
    if (outputDirHandle && (await verifyPermission(outputDirHandle)))
      return outputDirHandle;
    const saved = await dbGet("__output_dir__");
    if (saved && (await verifyPermission(saved))) {
      outputDirHandle = saved;
      return saved;
    }
    outputDirHandle = await window.showDirectoryPicker({
      id: "slides-tts-output",
      mode: "readwrite",
    });
    await dbPut("__output_dir__", outputDirHandle);
    return outputDirHandle;
  }

  async function writeBlobToDir(dirHandle, name, blob) {
    const fh = await dirHandle.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
  }

  // ── Save recordings to disk ─────────────────────────────────────
  async function getRecRoot({ interactive } = {}) {
    if (recRootHandle && (await verifyPermission(recRootHandle)))
      return recRootHandle;
    const saved = await dbGet("__rec_root_dir__");
    if (saved && (await verifyPermission(saved))) {
      recRootHandle = saved;
      return saved;
    }
    if (!interactive || !window.showDirectoryPicker) return null;
    recRootHandle = await window.showDirectoryPicker({
      id: "cleartalk-recordings",
      mode: "readwrite",
    });
    await dbPut("__rec_root_dir__", recRootHandle);
    return recRootHandle;
  }

  async function getSubDir(root2, parts) {
    let dir = root2;
    for (const p of parts)
      dir = await dir.getDirectoryHandle(safePart(p), { create: true });
    return dir;
  }

  // Returns true if written; false if no folder is configured yet (silent mode).
  async function saveRecordingToDisk(sectionId, version, { interactive } = {}) {
    const root2 = await getRecRoot({ interactive });
    if (!root2) return false;
    const dir = await getSubDir(root2, ["slides-editor", deckId, sectionId]);
    const ext = (version.mime || "").includes("wav") ? "wav" : "webm";
    const name = `${fileStamp(version.ts)}.${ext}`;
    const blob = new Blob([version.buf], {
      type: version.mime || "audio/webm",
    });
    await writeBlobToDir(dir, name, blob);
    return true;
  }

  // ── STT ─────────────────────────────────────────────────────────
  async function whisperTranscribe(blob) {
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

  async function vibevoiceTranscribe(blob) {
    const fd = new FormData();
    fd.append("file", blob, "rec.webm");
    fd.append("model", MLX_STT_MODEL);
    fd.append("language", "en");
    const resp = await fetch(MLX_STT_URL, { method: "POST", body: fd });
    if (!resp.ok) throw new Error(`MLX STT ${resp.status}`);
    return (await resp.json()).text || "";
  }

  // Is the local MLX server up? A network/timeout failure means "no" → we
  // fall back to WebSpeech. Any HTTP response (even an error code) means the
  // server answered, so it counts as reachable.
  async function mlxReachable() {
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

  async function transcribeBlob(engine, blob) {
    if (engine === "whisper") return whisperTranscribe(blob);
    return vibevoiceTranscribe(blob); // "vibevoice"
  }

  // ── Listen / New / Save ─────────────────────────────────────────
  async function onListen() {
    const cleanText = cleanForSpeech(section.text || "");
    if (!cleanText || !section.sectionId) return;

    listenBtn.disabled = true;
    listenBtn.textContent = "…";
    try {
      // Reuse the saved take if available; only synthesize when missing.
      const { version, hist } = await getOrCreateVersion(
        section.sectionId,
        cleanText,
      );
      showVersion(version, hist);
      audioEl.play();
    } catch (err) {
      alert(err.message);
    } finally {
      listenBtn.disabled = false;
      listenBtn.textContent = "🔄 Generate";
    }
  }

  // Save the current section's latest take into the chosen output folder.
  async function onSaveToFolder() {
    const cleanText = cleanForSpeech(section.text || "");
    if (!cleanText || !section.sectionId) return;

    saveBtn.disabled = true;
    const prev = saveBtn.textContent;
    try {
      // Reuse the saved take (synthesize only if none exists yet).
      const { version } = await getOrCreateVersion(
        section.sectionId,
        cleanText,
      );
      const blob = new Blob([version.buf], {
        type: version.mime || "audio/mpeg",
      });
      const name = audioFileName(section.title, version.mime);

      if (window.showDirectoryPicker) {
        saveBtn.textContent = "…";
        const dir = await ensureOutputDir();
        await writeBlobToDir(dir, name, blob);
        saveBtn.textContent = "✓ Saved";
      } else {
        // Firefox / Safari: no File System Access API → download instead.
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        saveBtn.textContent = "✓ Downloaded";
      }
      setTimeout(() => (saveBtn.textContent = prev), 1500);
    } catch (err) {
      // AbortError = user dismissed the folder picker; not an error.
      if (err.name !== "AbortError") alert(err.message);
      saveBtn.textContent = prev;
    } finally {
      saveBtn.disabled = false;
    }
  }

  // ── Record ──────────────────────────────────────────────────────
  // The mic is always captured (MediaRecorder) so the user can replay their
  // own voice. WebSpeech additionally runs live recognition for the transcript;
  // VibeVoice/Whisper transcribe the captured blob afterwards.
  async function onRecord() {
    if (isRecording) return;
    if (!section.sectionId) return;
    isRecording = true;
    recordBtn.className = "btn recording";
    recordBtn.textContent = "⏹ Stop";
    sttStatusEl.textContent = "";
    resetFeedback();

    let engine = STT_ENGINE;
    // VibeVoice (local MLX): if the server is unreachable, fall back to
    // WebSpeech before recording so the user's take isn't wasted.
    if (engine === "vibevoice") {
      sttStatusEl.className = "stt-status processing";
      sttStatusEl.textContent = "⟳ checking MLX…";
      if (!(await mlxReachable())) {
        console.warn("MLX STT unreachable — falling back to WebSpeech.");
        engine = "webspeech";
      }
    }
    recEngine = engine;

    // Capture the microphone for replay (all engines).
    try {
      recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      alert("Mic access denied.");
      resetRecordBtn();
      return;
    }
    recChunks = [];
    recMediaRecorder = new MediaRecorder(recStream);
    recMediaRecorder.ondataavailable = (e) => recChunks.push(e.data);
    recMediaRecorder.onstop = onRecordingStopped;
    recMediaRecorder.start();

    if (engine === "webspeech") startSpeechRecognition();

    sttStatusEl.className = "stt-status listening";
    sttStatusEl.textContent =
      engine === "webspeech" ? "● listening…" : "● recording…";
    recordBtn.onclick = stopRecording;
  }

  // Live transcript via the browser (runs alongside the recorder).
  function startSpeechRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    sttParts = [];
    if (!SR) {
      // No live recognition available — we still capture audio for replay.
      speechRec = null;
      return;
    }
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.continuous = true;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++)
        if (e.results[i].isFinal)
          sttParts.push(e.results[i][0].transcript.trim());
      if (sttParts.length)
        sttStatusEl.textContent = "● " + sttParts.join(" ").slice(-60);
    };
    rec.onerror = (e) => console.warn("WebSpeech error:", e.error);
    rec.start();
    speechRec = rec;
  }

  function stopRecording() {
    recordBtn.onclick = onRecord; // guard against double-stop
    if (speechRec) {
      try {
        speechRec.stop();
      } catch {
        /* ignore */
      }
      speechRec = null;
    }
    if (recMediaRecorder && recMediaRecorder.state !== "inactive")
      recMediaRecorder.stop(); // → onRecordingStopped
  }

  async function onRecordingStopped() {
    if (recStream) recStream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(recChunks, { type: "audio/webm" });
    recMediaRecorder = null;
    recStream = null;

    // Save the user's own voice and make it replayable immediately.
    const sectionId = section.sectionId;
    try {
      const { version, hist } = await saveRecording(sectionId, blob);
      showRecording(version, hist, { autoplay: true });
      // Auto-save to disk only if a folder was already chosen (no prompt here).
      try {
        await saveRecordingToDisk(sectionId, version, { interactive: false });
      } catch (e) {
        console.warn("disk save skipped:", e.message);
      }
    } catch (e) {
      console.warn("save recording failed:", e.message);
    }

    // Produce the transcript used for scoring.
    if (recEngine === "webspeech") {
      finishSTT(sttParts.join(" "));
      return;
    }
    sttStatusEl.className = "stt-status processing";
    sttStatusEl.textContent = "⟳ transcribing…";
    try {
      finishSTT(await transcribeBlob(recEngine, blob));
    } catch (err) {
      // VibeVoice failed at transcription (recording is still saved).
      if (recEngine === "vibevoice") {
        console.warn(
          "MLX STT failed, falling back to WebSpeech:",
          err.message,
        );
        sttStatusEl.className = "stt-status";
        sttStatusEl.textContent = "MLX failed (recording saved) → record again";
      } else {
        sttStatusEl.className = "stt-status";
        sttStatusEl.textContent = "Error: " + err.message;
      }
      resetRecordBtn();
    }
  }

  function resetRecordBtn() {
    recordBtn.className = "btn";
    recordBtn.textContent = "🎙 Record";
    recordBtn.onclick = onRecord;
    isRecording = false;
    sttStatusEl.textContent = "";
    sttStatusEl.className = "stt-status";
  }

  // Pick the recordings root folder (once) and save the latest take to disk.
  // After the root is chosen, new recordings auto-save in onRecordingStopped.
  async function onRecSaveFolder() {
    const sectionId = section.sectionId;
    if (!sectionId) return;
    recSaveBtn.disabled = true;
    const prev = recSaveBtn.textContent;
    try {
      const rh = await getRecordings(sectionId);
      if (!rh.versions.length) {
        alert("No recording yet — press 🎙 Record first.");
        return;
      }
      const latest = rh.versions[0];
      if (window.showDirectoryPicker) {
        recSaveBtn.textContent = "…";
        const ok = await saveRecordingToDisk(sectionId, latest, {
          interactive: true,
        });
        recSaveBtn.textContent = ok ? "✓ Saved" : prev;
      } else {
        // Firefox / Safari: no File System Access API → download instead.
        const url = URL.createObjectURL(
          new Blob([latest.buf], { type: latest.mime || "audio/webm" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = `${deckId}__${sectionId}__${fileStamp(latest.ts)}.webm`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        recSaveBtn.textContent = "✓ Downloaded";
      }
      setTimeout(() => (recSaveBtn.textContent = prev), 1500);
    } catch (err) {
      if (err.name !== "AbortError") alert(err.message);
      recSaveBtn.textContent = prev;
    } finally {
      recSaveBtn.disabled = false;
    }
  }

  // ── Feedback ────────────────────────────────────────────────────
  function finishSTT(transcript) {
    resetRecordBtn();
    if (!transcript.trim()) {
      sttStatusEl.textContent = "(no transcript)";
      return;
    }

    const cleanText = cleanForSpeech(section.text || "");
    const refTokens = tokenize(cleanText);
    const hypTokens = tokenize(transcript);
    const diff = diffTokens(refTokens, hypTokens);
    const score = scoreFromDiff(diff);
    const cls = scoreClass(score);

    // Diff
    diffEl.innerHTML = renderDiff(diff);

    // Score
    scoreBigEl.textContent = score + "%";
    scoreBigEl.style.color =
      cls === "great"
        ? "var(--green)"
        : cls === "ok"
          ? "var(--yellow)"
          : "var(--red)";
    scoreDescEl.textContent =
      cls === "great"
        ? "Great job!"
        : cls === "ok"
          ? "Keep practicing"
          : "Needs work";
    scoreDescEl.style.color = scoreBigEl.style.color;

    // Transcript
    transcriptRawEl.innerHTML = `Heard: <strong>${escapeHtml(transcript)}</strong>`;

    // Show feedback, hide hint
    feedbackHintEl.style.display = "none";
    feedbackAreaEl
      .querySelectorAll(".fb-block")
      .forEach((el) => (el.style.display = "block"));
    retryBtn.style.display = "inline-flex";

    // Host updates its own list badge.
    if (onScore) onScore(section.sectionId, score, cls);
  }

  function resetFeedback() {
    diffEl.innerHTML = "";
    scoreBigEl.textContent = "—";
    scoreBigEl.style.color = "";
    scoreDescEl.textContent = "";
    transcriptRawEl.innerHTML = "";
    retryBtn.style.display = "none";
    feedbackHintEl.style.display = "block";
    feedbackAreaEl
      .querySelectorAll(".fb-block")
      .forEach((el) => (el.style.display = "none"));
  }

  // ── Bind actions ────────────────────────────────────────────────
  listenBtn.onclick = onListen;
  saveBtn.onclick = onSaveToFolder;
  historySelectEl.onchange = async () => {
    if (!section.sectionId) return;
    const hist = await getHistory(section.sectionId);
    const v = hist.versions.find((x) => x.ts === Number(historySelectEl.value));
    if (v) showVersion(v, hist); // switch take without re-synthesizing
  };
  recHistorySelectEl.onchange = async () => {
    if (!section.sectionId) return;
    const hist = await getRecordings(section.sectionId);
    const v = hist.versions.find(
      (x) => x.ts === Number(recHistorySelectEl.value),
    );
    if (v) showRecording(v, hist); // replay an earlier take of your voice
  };
  recSaveBtn.onclick = onRecSaveFolder;
  recordBtn.onclick = onRecord;
  retryBtn.onclick = () => {
    resetFeedback();
    onRecord();
  };

  // ── Public: restore players for a section ───────────────────────
  function clearPlayers() {
    audioEl.classList.remove("show");
    audioEl.src = "";
    if (historySelectEl) {
      historySelectEl.style.display = "none";
      historySelectEl.innerHTML = "";
    }
    if (recAudioEl) {
      recAudioEl.classList.remove("show");
      recAudioEl.src = "";
    }
    if (recHistorySelectEl) {
      recHistorySelectEl.style.display = "none";
      recHistorySelectEl.innerHTML = "";
    }
  }

  async function setSection({ sectionId, title, text } = {}) {
    section = { sectionId: sectionId || null, title: title || "", text: text || "" };

    resetFeedback();
    listenBtn.textContent = "🔄 Generate";
    listenBtn.classList.remove("warn");
    clearPlayers();

    if (!section.sectionId) return;

    const cleanText = cleanForSpeech(section.text || "");
    if (cleanText) {
      try {
        const hist = await getHistory(section.sectionId);
        if (hist.versions.length) showVersion(hist.versions[0], hist);
      } catch {
        /* silent */
      }
    }
    // Restore the latest saved recording of the user's own voice.
    try {
      const recHist = await getRecordings(section.sectionId);
      if (recHist.versions.length)
        showRecording(recHist.versions[0], recHist);
    } catch {
      /* silent */
    }
  }

  // For deck export: reuse cache/history, returns the raw take.
  async function synthesize(sectionId, title, text) {
    const cleanText = cleanForSpeech(text || "");
    if (!cleanText) throw new Error("empty text");
    const { version } = await getOrCreateVersion(sectionId, cleanText);
    return { buf: version.buf, mime: version.mime || "audio/mpeg" };
  }

  function destroy() {
    try {
      if (speechRec) speechRec.stop();
    } catch {
      /* ignore */
    }
    speechRec = null;
    try {
      if (recMediaRecorder && recMediaRecorder.state !== "inactive")
        recMediaRecorder.stop();
    } catch {
      /* ignore */
    }
    if (recStream) recStream.getTracks().forEach((t) => t.stop());
    recMediaRecorder = null;
    recStream = null;
    isRecording = false;
    container.innerHTML = "";
  }

  return {
    setSection,
    setSpeed(x) {
      currentSpeed = x;
      audioEl.playbackRate = currentSpeed;
    },
    setEngine(name) {
      currentTTSEngine = name;
      // Clear current model audio so the next Listen re-fetches.
      audioEl.src = "";
      audioEl.classList.remove("show");
    },
    getEngine() {
      return currentTTSEngine;
    },
    synthesize,
    destroy,
  };
}
