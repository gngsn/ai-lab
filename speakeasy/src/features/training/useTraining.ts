// State and actions of the pronunciation training panel (port of
// createTrainingPanel in the legacy training-panel.js): Generate / Upload with a
// take history, Record + live or server speech recognition + word-by-word
// scoring, and the user's own recording history.
import { useCallback, useEffect, useRef, useState } from "react";
import { getSlideAudio, uploadSlideAudio } from "../../data/audio";
import { trainingConfig } from "./config";
import { canPickFolder, createRecordingFolder, downloadRecording } from "./folder";
import { mlxReachable, transcribeBlob } from "./stt";
import { createTakes, type History, type RecVersion, type TtsVersion } from "./takes";
import {
  cleanForSpeech,
  type DiffItem,
  diffTokens,
  type ScoreClass,
  scoreClass,
  scoreFromDiff,
  tokenize,
} from "./text";

export type TrainingSection = { sectionId: string | null; title: string; text: string };
export type TrainingOptions = {
  deckId: string;
  section: TrainingSection;
  speed: number;
  engine: string;
  onScore?: (sectionId: string, score: number, cls: ScoreClass) => void;
};
export type Feedback = { diff: DiffItem[]; score: number; cls: ScoreClass; transcript: string };
type Status = { text: string; cls: string };
type Player<T> = { versions: T[]; active: number | null; src: string | null };

const LISTEN = "🔄 Generate";
const UPLOAD = "☁️ Upload";
const FOLDER = "📁 Folder";
const NO_STATUS: Status = { text: "", cls: "" };
const EMPTY_PLAYER = { versions: [], active: null, src: null };

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
};
type SpeechResultEvent = {
  resultIndex: number;
  results: {
    length: number;
    [i: number]: { isFinal: boolean; [j: number]: { transcript: string } };
  };
};

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useTraining({ deckId, section, speed, engine, onScore }: TrainingOptions) {
  const [listenLabel, setListenLabel] = useState(LISTEN);
  const [listenBusy, setListenBusy] = useState(false);
  const [uploadLabel, setUploadLabel] = useState(UPLOAD);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [folderLabel, setFolderLabel] = useState(FOLDER);
  const [folderBusy, setFolderBusy] = useState(false);
  const [tts, setTts] = useState<Player<TtsVersion>>(EMPTY_PLAYER);
  const [rec, setRec] = useState<Player<RecVersion>>(EMPTY_PLAYER);
  const [recording, setRecording] = useState(false);
  const [status, setStatusState] = useState<Status>(NO_STATUS);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [ttsPlay, setTtsPlay] = useState(0);
  const [recPlay, setRecPlay] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const recAudioRef = useRef<HTMLAudioElement>(null);

  // Mutable state of the legacy closure.
  const takes = useRef(createTakes(deckId));
  const folder = useRef(createRecordingFolder(deckId));
  const sectionRef = useRef(section);
  const speedRef = useRef(speed);
  const engineRef = useRef(engine);
  const onScoreRef = useRef(onScore);
  speedRef.current = speed;
  engineRef.current = engine;
  onScoreRef.current = onScore;
  const isRecording = useRef(false);
  const stopArmed = useRef(false); // the Record button stops only once the mic is open
  const speechRec = useRef<SpeechRecognitionLike | null>(null);
  const sttParts = useRef<string[]>([]);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const recEngine = useRef("");
  const urls = useRef({ tts: new Map<number, string>(), rec: new Map<number, string>() });
  const uploadLabelRef = useRef(UPLOAD);
  const folderLabelRef = useRef(FOLDER);
  const timers = useRef(new Set<number>());

  const setStatus = (text: string, cls?: string) =>
    setStatusState((prev) => ({ text, cls: cls ?? prev.cls }));
  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  };
  const urlOf = (
    kind: "tts" | "rec",
    v: { ts: number; buf: ArrayBuffer; mime: string },
    fallback: string,
  ) => {
    const cache = urls.current[kind];
    let url = cache.get(v.ts);
    if (!url) {
      url = URL.createObjectURL(new Blob([v.buf], { type: v.mime || fallback }));
      cache.set(v.ts, url);
    }
    return url;
  };

  // ── Players ─────────────────────────────────────────────────────
  const showVersion = (version: TtsVersion, hist: History<TtsVersion>, play = false) => {
    setTts({
      versions: hist.versions,
      active: version.ts,
      src: urlOf("tts", version, "audio/mpeg"),
    });
    if (play) setTtsPlay((n) => n + 1);
  };
  const showRecording = (version: RecVersion, hist: History<RecVersion>, play = false) => {
    setRec({
      versions: hist.versions,
      active: version.ts,
      src: urlOf("rec", version, "audio/webm"),
    });
    if (play) setRecPlay((n) => n + 1);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: loading a new take resets the rate
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed, tts.src]);
  useEffect(() => {
    if (!ttsPlay || !audioRef.current) return;
    audioRef.current.currentTime = 0; // a fresh load starts from the top
    audioRef.current.play().catch(() => {});
  }, [ttsPlay]);
  useEffect(() => {
    if (!recPlay || !recAudioRef.current) return;
    recAudioRef.current.currentTime = 0;
    recAudioRef.current.play().catch(() => {});
  }, [recPlay]);

  // ── Generate / Upload ───────────────────────────────────────────
  const speak = (sectionId: string, cleanText: string) =>
    takes.current.getOrCreateVersion(sectionId, cleanText, {
      engine: engineRef.current,
      speed: speedRef.current,
    });

  async function onListen() {
    const cur = sectionRef.current;
    const cleanText = cleanForSpeech(cur.text || "");
    if (!cleanText || !cur.sectionId) return;
    setListenBusy(true);
    setListenLabel("…");
    try {
      // Reuse the saved take if available; only synthesize when missing.
      const { version, hist } = await speak(cur.sectionId, cleanText);
      showVersion(version, hist, true);
    } catch (err) {
      alert(errorText(err));
    } finally {
      setListenBusy(false);
      setListenLabel(LISTEN);
    }
  }

  const setUpload = (label: string) => {
    uploadLabelRef.current = label;
    setUploadLabel(label);
  };
  // Upload the current section's take to Supabase Storage (shared copy).
  // Reuses the saved take, synthesizing once only if none exists yet.
  async function onUpload() {
    const cur = sectionRef.current;
    const cleanText = cleanForSpeech(cur.text || "");
    if (!cleanText || !cur.sectionId) return;
    setUploadBusy(true);
    const prev = uploadLabelRef.current;
    try {
      setUpload("…");
      const { sectionId } = cur;
      const { version, hist } = await speak(sectionId, cleanText);
      const blob = new Blob([version.buf], { type: version.mime || "audio/mpeg" });
      const { path } = await uploadSlideAudio(deckId, sectionId, blob);
      // Mark this take as the uploaded/remote copy so it's reused on reload.
      version.remotePath = path;
      await takes.current.saveHistory(sectionId, hist);
      setUpload("✓ Uploaded");
      later(() => setUpload(prev), 1500);
    } catch (err) {
      alert(`Upload failed: ${errorText(err)}`);
      setUpload(prev);
    } finally {
      setUploadBusy(false);
    }
  }

  // ── Feedback ────────────────────────────────────────────────────
  const resetRecordBtn = () => {
    stopArmed.current = false;
    isRecording.current = false;
    setRecording(false);
    setStatusState({ text: "", cls: "" });
  };

  function finishSTT(transcript: string) {
    resetRecordBtn();
    if (!transcript.trim()) {
      setStatus("(no transcript)");
      return;
    }
    const cur = sectionRef.current;
    const diff = diffTokens(tokenize(cleanForSpeech(cur.text || "")), tokenize(transcript));
    const score = scoreFromDiff(diff);
    const cls = scoreClass(score);
    setFeedback({ diff, score, cls, transcript });
    // Host updates its own list badge.
    if (cur.sectionId) onScoreRef.current?.(cur.sectionId, score, cls);
  }

  // ── Record ──────────────────────────────────────────────────────
  // The mic is always captured (MediaRecorder) so the user can replay their own voice.
  // WebSpeech additionally runs live recognition for the transcript; VibeVoice/Whisper
  // transcribe the captured blob afterwards.
  async function onRecord() {
    if (isRecording.current) return;
    if (!sectionRef.current.sectionId) return;
    isRecording.current = true;
    setRecording(true);
    setStatus("");
    setFeedback(null);

    let engineName: string = trainingConfig().sttEngine;
    // VibeVoice (local MLX): if the server is unreachable, fall back to WebSpeech before
    // recording so the user's take isn't wasted.
    if (engineName === "vibevoice") {
      setStatus("⟳ checking MLX…", "processing");
      if (!(await mlxReachable())) {
        console.warn("MLX STT unreachable — falling back to WebSpeech.");
        engineName = "webspeech";
      }
    }
    recEngine.current = engineName;

    // Capture the microphone for replay (all engines).
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      alert("Mic access denied.");
      resetRecordBtn();
      return;
    }
    chunks.current = [];
    const mr = new MediaRecorder(stream.current);
    mr.ondataavailable = (e) => chunks.current.push(e.data);
    mr.onstop = () => void onRecordingStopped();
    recorder.current = mr;
    mr.start();

    if (engineName === "webspeech") startSpeechRecognition();

    setStatus(engineName === "webspeech" ? "● listening…" : "● recording…", "listening");
    stopArmed.current = true;
  }

  // Live transcript via the browser (runs alongside the recorder).
  function startSpeechRecognition() {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    sttParts.current = [];
    if (!SR) {
      // No live recognition available — we still capture audio for replay.
      speechRec.current = null;
      return;
    }
    const r = new SR();
    r.lang = "en-US";
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.continuous = true;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++)
        if (e.results[i].isFinal) sttParts.current.push(e.results[i][0].transcript.trim());
      if (sttParts.current.length) setStatus(`● ${sttParts.current.join(" ").slice(-60)}`);
    };
    r.onerror = (e) => console.warn("WebSpeech error:", e.error);
    r.start();
    speechRec.current = r;
  }

  function stopRecording() {
    stopArmed.current = false; // guard against double-stop
    if (speechRec.current) {
      try {
        speechRec.current.stop();
      } catch {
        /* ignore */
      }
      speechRec.current = null;
    }
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop(); // → onRecordingStopped
  }

  async function onRecordingStopped() {
    stream.current?.getTracks().forEach((t) => {
      t.stop();
    });
    const blob = new Blob(chunks.current, { type: "audio/webm" });
    recorder.current = null;
    stream.current = null;

    // Save the user's own voice and make it replayable immediately.
    const { sectionId } = sectionRef.current;
    try {
      if (!sectionId) throw new Error("no section");
      const { version, hist } = await takes.current.saveRecording(sectionId, blob);
      showRecording(version, hist, true);
      // Auto-save to disk only if a folder was already chosen (no prompt here).
      try {
        await folder.current.save(sectionId, version, { interactive: false });
      } catch (e) {
        console.warn("disk save skipped:", errorText(e));
      }
    } catch (e) {
      console.warn("save recording failed:", errorText(e));
    }

    // Produce the transcript used for scoring.
    if (recEngine.current === "webspeech") {
      finishSTT(sttParts.current.join(" "));
      return;
    }
    setStatus("⟳ transcribing…", "processing");
    try {
      finishSTT(await transcribeBlob(recEngine.current, blob));
    } catch (err) {
      // The legacy panel wrote "MLX failed (recording saved) → record again" (or
      // "Error: …") here and cleared it again in the same step, so nothing is shown.
      console.warn(
        recEngine.current === "vibevoice"
          ? "MLX STT failed, falling back to WebSpeech:"
          : "STT failed:",
        errorText(err),
      );
      resetRecordBtn();
    }
  }

  const onRecordClick = () => (stopArmed.current ? stopRecording() : void onRecord());
  const onRetry = () => {
    setFeedback(null);
    void onRecord();
  };

  // Pick the recordings root folder (once) and save the latest take to disk.
  // After the root is chosen, new recordings auto-save when a recording stops.
  const setFolder = (label: string) => {
    folderLabelRef.current = label;
    setFolderLabel(label);
  };
  async function onFolder() {
    const { sectionId } = sectionRef.current;
    if (!sectionId) return;
    setFolderBusy(true);
    const prev = folderLabelRef.current;
    try {
      const recs = await takes.current.getRecordings(sectionId);
      if (!recs.versions.length) {
        alert("No recording yet — press 🎙 Record first.");
        return;
      }
      const latest = recs.versions[0];
      if (canPickFolder()) {
        setFolder("…");
        const ok = await folder.current.save(sectionId, latest, { interactive: true });
        setFolder(ok ? "✓ Saved" : prev);
      } else {
        // Firefox / Safari: no File System Access API → download instead.
        downloadRecording(deckId, sectionId, latest);
        setFolder("✓ Downloaded");
      }
      later(() => setFolder(prev), 1500);
    } catch (err) {
      if ((err as { name?: string }).name !== "AbortError") alert(errorText(err));
      setFolder(prev);
    } finally {
      setFolderBusy(false);
    }
  }

  // ── Take selection ──────────────────────────────────────────────
  async function onPickTake(ts: number) {
    const { sectionId } = sectionRef.current;
    if (!sectionId) return;
    const hist = await takes.current.getHistory(sectionId);
    const v = hist.versions.find((x) => x.ts === ts);
    if (v) showVersion(v, hist); // switch take without re-synthesizing
  }
  async function onPickRecording(ts: number) {
    const { sectionId } = sectionRef.current;
    if (!sectionId) return;
    const hist = await takes.current.getRecordings(sectionId);
    const v = hist.versions.find((x) => x.ts === ts);
    if (v) showRecording(v, hist); // replay an earlier take of your voice
  }

  // ── The section changed: restore its players ────────────────────
  // If Supabase has audio for this slide, download it once, cache it as a take (so Generate and
  // replay reuse it — no re-synthesis), and show it.
  async function adoptRemoteAudio(sectionId: string) {
    let remote: Awaited<ReturnType<typeof getSlideAudio>>;
    try {
      remote = await getSlideAudio(deckId, sectionId);
    } catch {
      return; // offline / bucket missing — keep the local take
    }
    if (!remote || sectionId !== sectionRef.current.sectionId) return;

    const hist = await takes.current.getHistory(sectionId);
    const cached = hist.versions.find((v) => v.remotePath === remote.path);
    if (cached) {
      showVersion(cached, hist);
      return;
    }
    const resp = await fetch(remote.url);
    if (!resp.ok || sectionId !== sectionRef.current.sectionId) return;
    const version = await takes.current.addRemoteVersion(
      sectionId,
      hist,
      await resp.blob(),
      remote.path,
      cleanForSpeech(sectionRef.current.text || ""),
    );
    if (sectionId === sectionRef.current.sectionId) showVersion(version, hist);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the host hands over a new section
  useEffect(() => {
    const next = {
      sectionId: section.sectionId || null,
      title: section.title || "",
      text: section.text || "",
    };
    sectionRef.current = next;
    setFeedback(null);
    setListenLabel(LISTEN);
    setTts(EMPTY_PLAYER);
    setRec(EMPTY_PLAYER);
    const { sectionId } = next;
    if (!sectionId) return;
    const current = () => sectionRef.current.sectionId === sectionId;
    void (async () => {
      if (cleanForSpeech(next.text)) {
        try {
          const hist = await takes.current.getHistory(sectionId);
          if (hist.versions.length && current()) showVersion(hist.versions[0], hist);
        } catch {
          /* silent */
        }
      }
      // Restore the latest saved recording of the user's own voice.
      try {
        const recs = await takes.current.getRecordings(sectionId);
        if (recs.versions.length && current()) showRecording(recs.versions[0], recs);
      } catch {
        /* silent */
      }
      // Prefer the shared Supabase take if one exists for this slide.
      adoptRemoteAudio(sectionId).catch(() => {});
    })();
  }, [section]);

  // A different engine clears the model audio so the next Generate asks that engine.
  const firstEngine = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only an engine change matters
  useEffect(() => {
    if (firstEngine.current) {
      firstEngine.current = false;
      return;
    }
    setTts((prev) => ({ ...prev, src: null }));
  }, [engine]);

  // For deck export: reuse cache/history, returns the raw take.
  const synthesize = useCallback(async (sectionId: string, _title: string, text: string) => {
    const cleanText = cleanForSpeech(text || "");
    if (!cleanText) throw new Error("empty text");
    const { version } = await takes.current.getOrCreateVersion(sectionId, cleanText, {
      engine: engineRef.current,
      speed: speedRef.current,
    });
    return { buf: version.buf, mime: version.mime || "audio/mpeg" };
  }, []);

  // destroy
  useEffect(() => {
    const live = { urls: urls.current, timers: timers.current };
    return () => {
      try {
        speechRec.current?.stop();
      } catch {
        /* ignore */
      }
      speechRec.current = null;
      try {
        if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
      } catch {
        /* ignore */
      }
      stream.current?.getTracks().forEach((t) => {
        t.stop();
      });
      recorder.current = null;
      stream.current = null;
      isRecording.current = false;
      for (const id of live.timers) window.clearTimeout(id);
      for (const map of [live.urls.tts, live.urls.rec]) {
        for (const url of map.values()) URL.revokeObjectURL(url);
        map.clear();
      }
    };
  }, []);

  return {
    audioRef,
    recAudioRef,
    listen: { label: listenLabel, busy: listenBusy, run: () => void onListen() },
    upload: { label: uploadLabel, busy: uploadBusy, run: () => void onUpload() },
    folder: { label: folderLabel, busy: folderBusy, run: () => void onFolder() },
    recording,
    status,
    feedback,
    tts,
    rec,
    onRecordClick,
    onRetry,
    onPickTake: (ts: number) => void onPickTake(ts),
    onPickRecording: (ts: number) => void onPickRecording(ts),
    synthesize,
  };
}
