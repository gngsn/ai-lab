// Text-to-speech requests of the training panel (local Kokoro, OpenAI,
// ElevenLabs). Port of the fetchers in the legacy training-panel.js: same
// URLs, headers, bodies, chunking and error messages.
import { OPENAI_TTS_LIMIT, type TtsEngine, trainingConfig } from "./config";
import { splitTextChunks } from "./text";
import { mergeBlobs } from "./wav";

async function failed(label: string, resp: Response): Promise<Error> {
  const msg = await resp.text().catch(() => resp.statusText);
  return new Error(`${label} ${resp.status}: ${msg}`);
}

async function kokoroChunk(text: string, speed: number): Promise<Blob> {
  const cfg = trainingConfig();
  const resp = await fetch(cfg.kokoroUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: cfg.kokoroModel,
      input: text,
      voice: cfg.kokoroVoice,
      response_format: "mp3",
      speed,
    }),
  });
  if (!resp.ok) throw await failed("Kokoro TTS", resp);
  return resp.blob();
}

async function openAiChunk(text: string, speed: number): Promise<Blob> {
  const { openAiKey } = trainingConfig();
  if (!openAiKey) throw new Error("OPENAI_API_KEY not set in config.local.js");
  const resp = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${openAiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "tts-1", voice: "alloy", input: text, speed }),
  });
  if (!resp.ok) throw await failed("OpenAI TTS", resp);
  return resp.blob();
}

/** Long scripts go out in pieces that fit the limit and are joined into one WAV. */
async function chunked(
  text: string,
  speed: number,
  one: (text: string, speed: number) => Promise<Blob>,
): Promise<Blob> {
  const chunks = splitTextChunks(text, OPENAI_TTS_LIMIT);
  if (chunks.length === 1) return one(chunks[0], speed);
  return mergeBlobs(await Promise.all(chunks.map((c) => one(c, speed))));
}

async function elevenLabs(text: string, speed: number): Promise<Blob> {
  const cfg = trainingConfig();
  if (!cfg.elevenLabsKey) throw new Error("ELEVENLABS_API_KEY not set in config.local.js");
  const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${cfg.elevenLabsVoice}`, {
    method: "POST",
    headers: {
      "xi-api-key": cfg.elevenLabsKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.75, speed },
    }),
  });
  if (!resp.ok) throw await failed("ElevenLabs", resp);
  return resp.blob();
}

/** Speak `text` with `engine` at `speed`; anything but openai/elevenlabs is the local Kokoro. */
export function synthesizeSpeech(engine: string, text: string, speed: number): Promise<Blob> {
  if ((engine as TtsEngine) === "elevenlabs") return elevenLabs(text, speed);
  if ((engine as TtsEngine) === "openai") return chunked(text, speed, openAiChunk);
  return chunked(text, speed, kokoroChunk);
}
