// Settings of the pronunciation training panel. They come from window globals
// set by js/config.local.js and are read when used, so a page that sets them
// late still works.
export type TtsEngine = "kokoro" | "openai" | "elevenlabs";
export type SttEngine = "vibevoice" | "whisper" | "webspeech";

type Globals = Record<string, string | undefined>;
const g = (): Globals => window as unknown as Globals;

export function trainingConfig() {
  const w = g();
  return {
    elevenLabsKey: w.ELEVENLABS_API_KEY || "",
    elevenLabsVoice: w.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM",
    sttEngine: (w.PRONUNCIATION_STT || "vibevoice") as SttEngine,
    openAiKey: w.OPENAI_API_KEY || "",
    // Local MLX speech-to-text (OpenAI-compatible /v1/audio/transcriptions server).
    mlxSttUrl: w.MLX_STT_URL || "http://localhost:8000/v1/audio/transcriptions",
    mlxSttModel: w.MLX_STT_MODEL || "mlx-community/VibeVoice-ASR-4bit",
    // Local Kokoro-82M TTS via an OpenAI-compatible server (e.g. Kokoro-FastAPI).
    kokoroUrl: w.KOKORO_TTS_URL || "http://localhost:8880/v1/audio/speech",
    kokoroModel: w.KOKORO_TTS_MODEL || "kokoro",
    kokoroVoice: w.KOKORO_VOICE || "af_heart",
  };
}

export function defaultTtsEngine(): TtsEngine {
  return (g().PRONUNCIATION_TTS || "kokoro") as TtsEngine;
}

export const OPENAI_TTS_LIMIT = 4000; // leave 96 chars margin
export const MAX_HISTORY = 10;
