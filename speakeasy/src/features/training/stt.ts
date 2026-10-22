// Speech-to-text of the training panel: the local MLX server (VibeVoice) or
// OpenAI Whisper transcribe a recorded blob. Port of the STT helpers in
// public/js/training-panel.js.
import { trainingConfig } from "./config";

async function whisper(blob: Blob): Promise<string> {
  const { openAiKey } = trainingConfig();
  if (!openAiKey) throw new Error("OPENAI_API_KEY not set");
  const fd = new FormData();
  fd.append("file", blob, "rec.webm");
  fd.append("model", "whisper-1");
  fd.append("language", "en");
  const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openAiKey}` },
    body: fd,
  });
  if (!resp.ok) throw new Error(`Whisper ${resp.status}`);
  return ((await resp.json()) as { text?: string }).text || "";
}

async function vibevoice(blob: Blob): Promise<string> {
  const cfg = trainingConfig();
  const fd = new FormData();
  fd.append("file", blob, "rec.webm");
  fd.append("model", cfg.mlxSttModel);
  fd.append("language", "en");
  const resp = await fetch(cfg.mlxSttUrl, { method: "POST", body: fd });
  if (!resp.ok) throw new Error(`MLX STT ${resp.status}`);
  return ((await resp.json()) as { text?: string }).text || "";
}

/** Transcribe a recording with the chosen engine (anything but "whisper" is the MLX server). */
export function transcribeBlob(engine: string, blob: Blob): Promise<string> {
  return engine === "whisper" ? whisper(blob) : vibevoice(blob);
}

/**
 * Is the local MLX server up? A network failure or a 1.5 s silence means no, and the panel
 * falls back to the browser's speech recognition. Any HTTP answer, even an error code, counts
 * as reachable.
 */
export async function mlxReachable(): Promise<boolean> {
  const base = trainingConfig().mlxSttUrl.replace(/\/v1\/.*$/, "");
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
