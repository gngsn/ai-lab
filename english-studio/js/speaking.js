/**
 * speaking.js — listen to a native-speaker model, record yourself, get
 * word-level pronunciation scoring plus pace (WPM).
 *
 * STT: vibevoice (local MLX) → auto-fallback to WebSpeech; or whisper.
 * The mic is always captured with MediaRecorder so the take is replayable.
 */

import { $, escapeHtml, fmtTime, sha1, initNav } from "./common.js";
import { synthesize, DEFAULT_ENGINE } from "./tts.js";
import { STT_ENGINE, mlxReachable, transcribeBlob } from "./stt.js";
import { tokenize, diffTokens, scoreFromDiff, scoreClass, renderDiff } from "./diff.js";
import { saveRecording, getRecordings } from "./audio-cache.js";

initNav();

// ── State ─────────────────────────────────────────────────────────
let speed = 1.0;
let engine = DEFAULT_ENGINE;
let isRecording = false;
let recStream = null;
let recMediaRecorder = null;
let recChunks = [];
let recEngine = null;
let recStartTs = 0;
let recDurationSec = 0;
let speechRec = null;
let sttParts = [];
const recUrlCache = new Map(); // ts → objectURL

const modelAudioEl = $("model-audio");
const recAudioEl = $("rec-audio");
const statusEl = $("stt-status");

// Namespace recordings by the practice text's hash.
async function recNamespace() {
  return "speak/" + (await sha1($("practice-text").value.trim()));
}

// ── Listen (TTS model) ────────────────────────────────────────────
$("listen-btn").onclick = async () => {
  const text = $("practice-text").value.trim();
  if (!text) return;
  const btn = $("listen-btn");
  btn.disabled = true;
  btn.textContent = "…";
  try {
    const blob = await synthesize(text, engine);
    modelAudioEl.src = URL.createObjectURL(blob);
    modelAudioEl.classList.add("show");
    modelAudioEl.playbackRate = speed;
    modelAudioEl.play();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "▶ 원어민 듣기";
  }
};

// ── Record ────────────────────────────────────────────────────────
const recordBtn = $("record-btn");

async function onRecord() {
  if (isRecording) return;
  const text = $("practice-text").value.trim();
  if (!text) {
    statusEl.textContent = "먼저 연습할 문장을 입력하세요";
    return;
  }
  isRecording = true;
  recordBtn.className = "btn recording";
  recordBtn.textContent = "⏹ 정지";
  statusEl.textContent = "";
  resetFeedback();

  let sttEngine = STT_ENGINE;
  if (sttEngine === "vibevoice") {
    statusEl.className = "stt-status processing";
    statusEl.textContent = "⟳ MLX 서버 확인 중…";
    if (!(await mlxReachable())) {
      console.warn("MLX STT unreachable — falling back to WebSpeech.");
      sttEngine = "webspeech";
    }
  }
  recEngine = sttEngine;

  try {
    recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    alert("마이크 권한이 필요해요.");
    resetRecordBtn();
    return;
  }
  recChunks = [];
  recMediaRecorder = new MediaRecorder(recStream);
  recMediaRecorder.ondataavailable = (e) => recChunks.push(e.data);
  recMediaRecorder.onstop = onRecordingStopped;
  recMediaRecorder.start();
  recStartTs = Date.now();

  if (sttEngine === "webspeech") startSpeechRecognition();

  statusEl.className = "stt-status listening";
  statusEl.textContent =
    sttEngine === "webspeech" ? "● 듣는 중… (WebSpeech)" : "● 녹음 중…";
  recordBtn.onclick = stopRecording;
}

function startSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  sttParts = [];
  if (!SR) {
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
      if (e.results[i].isFinal) sttParts.push(e.results[i][0].transcript.trim());
    if (sttParts.length)
      statusEl.textContent = "● " + sttParts.join(" ").slice(-60);
  };
  rec.onerror = (e) => console.warn("WebSpeech error:", e.error);
  rec.start();
  speechRec = rec;
}

function stopRecording() {
  recordBtn.onclick = onRecord; // guard against double-stop
  recDurationSec = (Date.now() - recStartTs) / 1000;
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

  // Save & show the user's own take immediately.
  try {
    const ns = await recNamespace();
    const { version, hist } = await saveRecording(ns, blob);
    showRecording(version, hist);
  } catch (e) {
    console.warn("save recording failed:", e.message);
  }

  if (recEngine === "webspeech") {
    finishSTT(sttParts.join(" "));
    return;
  }
  statusEl.className = "stt-status processing";
  statusEl.textContent = "⟳ 음성 인식 중…";
  try {
    finishSTT(await transcribeBlob(recEngine, blob));
  } catch (err) {
    statusEl.className = "stt-status";
    statusEl.textContent =
      recEngine === "vibevoice"
        ? "MLX 인식 실패 (녹음은 저장됨) → 다시 녹음해 보세요"
        : "오류: " + err.message;
    resetRecordBtn();
  }
}

function resetRecordBtn() {
  recordBtn.className = "btn danger";
  recordBtn.textContent = "🎙 녹음";
  recordBtn.onclick = onRecord;
  isRecording = false;
  statusEl.textContent = "";
  statusEl.className = "stt-status";
}

// ── Recording history ─────────────────────────────────────────────
function recUrl(v) {
  let url = recUrlCache.get(v.ts);
  if (!url) {
    url = URL.createObjectURL(new Blob([v.buf], { type: v.mime || "audio/webm" }));
    recUrlCache.set(v.ts, url);
  }
  return url;
}

function showRecording(version, hist) {
  recAudioEl.src = recUrl(version);
  recAudioEl.classList.add("show");
  const sel = $("rec-history");
  const versions = (hist && hist.versions) || [];
  if (!versions.length) {
    sel.style.display = "none";
    return;
  }
  const n = versions.length;
  sel.innerHTML = versions
    .map(
      (v, i) =>
        `<option value="${v.ts}"${v.ts === version.ts ? " selected" : ""}>take ${n - i} · ${fmtTime(v.ts)}</option>`,
    )
    .join("");
  sel.style.display = "";
}

$("rec-history").onchange = async () => {
  const hist = await getRecordings(await recNamespace());
  const v = hist.versions.find((x) => x.ts === Number($("rec-history").value));
  if (v) showRecording(v, hist);
};

// Restore the latest take when the practice text changes.
$("practice-text").addEventListener("blur", async () => {
  const text = $("practice-text").value.trim();
  if (!text) return;
  try {
    const hist = await getRecordings(await recNamespace());
    if (hist.versions.length) showRecording(hist.versions[0], hist);
    else {
      recAudioEl.classList.remove("show");
      $("rec-history").style.display = "none";
    }
  } catch {
    /* silent */
  }
});

// ── Feedback ──────────────────────────────────────────────────────
function finishSTT(transcript) {
  resetRecordBtn();
  if (!transcript.trim()) {
    statusEl.textContent = "(음성이 인식되지 않았어요)";
    return;
  }

  const refText = $("practice-text").value.trim();
  const refTokens = tokenize(refText);
  const hypTokens = tokenize(transcript);
  const diff = diffTokens(refTokens, hypTokens);
  const score = scoreFromDiff(diff);
  const cls = scoreClass(score);

  const color =
    cls === "great" ? "var(--green)" : cls === "ok" ? "var(--yellow)" : "var(--red)";
  $("score-big").textContent = score + "%";
  $("score-big").style.color = color;
  $("score-desc").textContent =
    cls === "great" ? "훌륭해요! 🎉" : cls === "ok" ? "조금만 더 연습!" : "다시 도전해 봐요";
  $("score-desc").style.color = color;

  const wpm = recDurationSec > 0 ? Math.round((hypTokens.length / recDurationSec) * 60) : 0;
  $("stat-wpm").textContent = wpm || "—";
  $("stat-dur").textContent = recDurationSec.toFixed(1);
  $("stat-words").textContent = `${hypTokens.length}/${refTokens.length}`;

  $("diff-text").innerHTML = renderDiff(diff);
  $("transcript-raw").innerHTML = escapeHtml(transcript);

  $("feedback-hint").style.display = "none";
  document
    .querySelectorAll("#result-pane .fb-block")
    .forEach((el) => (el.style.display = "block"));
  $("retry-btn").style.display = "inline-flex";
}

function resetFeedback() {
  $("feedback-hint").style.display = "block";
  document
    .querySelectorAll("#result-pane .fb-block")
    .forEach((el) => (el.style.display = "none"));
  $("retry-btn").style.display = "none";
}

// ── Bind ──────────────────────────────────────────────────────────
recordBtn.onclick = onRecord;
$("retry-btn").onclick = () => {
  resetFeedback();
  onRecord();
};

$("speed-slider").oninput = (e) => {
  speed = parseFloat(e.target.value);
  $("speed-label").textContent = speed.toFixed(2).replace(/0$/, "") + "×";
  modelAudioEl.playbackRate = speed;
};

const engineSel = $("tts-engine");
engineSel.value = engine;
engineSel.onchange = () => {
  engine = engineSel.value;
};
