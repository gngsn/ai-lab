/**
 * listening.js — paste an article, listen sentence-by-sentence.
 *
 * Articles are stored in localStorage; audio is cached per-sentence in
 * IndexedDB (see tts.js). Playback pre-fetches the next sentence while the
 * current one plays, so "전체 재생" flows without gaps.
 */

import { $, escapeHtml, splitParagraphs, initNav } from "./common.js";
import { synthesize, DEFAULT_ENGINE } from "./tts.js";

initNav();

const STORAGE_KEY = "english-studio/articles";

// ── State ─────────────────────────────────────────────────────────
let articles = loadArticles();
let currentId = null;
let sentences = []; // flat [{text, el}]
let playIndex = -1;
let playing = false;
let playToken = 0; // increments to cancel an in-flight playback loop
let speed = 1.0;
let engine = DEFAULT_ENGINE;

const audioEl = new Audio();

// ── Article storage ───────────────────────────────────────────────
function loadArticles() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}
function saveArticles() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(articles));
}

// ── Sidebar ───────────────────────────────────────────────────────
function renderList() {
  const list = $("article-list");
  list.innerHTML = "";
  if (!articles.length) {
    list.innerHTML =
      '<div class="side-item" style="cursor:default">아직 아티클이 없어요</div>';
    return;
  }
  for (const a of articles) {
    const item = document.createElement("div");
    item.className = "side-item" + (a.id === currentId ? " active" : "");
    item.innerHTML = `<span class="label">${escapeHtml(a.title)}</span>
      <button class="del" title="삭제">✕</button>`;
    item.addEventListener("click", () => openArticle(a.id));
    item.querySelector(".del").addEventListener("click", (e) => {
      e.stopPropagation();
      if (!confirm(`"${a.title}" 삭제할까요?`)) return;
      articles = articles.filter((x) => x.id !== a.id);
      saveArticles();
      if (currentId === a.id) showForm();
      renderList();
    });
    list.appendChild(item);
  }
}

// ── Views ─────────────────────────────────────────────────────────
function showForm() {
  stopPlayback();
  currentId = null;
  $("article-form").style.display = "";
  $("reader-view").style.display = "none";
  renderList();
}

function openArticle(id) {
  const article = articles.find((a) => a.id === id);
  if (!article) return;
  stopPlayback();
  currentId = id;
  $("article-form").style.display = "none";
  $("reader-view").style.display = "";
  renderReader(article.text);
  renderList();
}

function renderReader(text) {
  const reader = $("reader");
  reader.innerHTML = "";
  sentences = [];
  for (const para of splitParagraphs(text)) {
    const p = document.createElement("p");
    for (const sent of para) {
      const span = document.createElement("span");
      span.className = "sent";
      span.textContent = sent;
      const idx = sentences.length;
      span.onclick = () => playFrom(idx);
      sentences.push({ text: sent, el: span });
      p.appendChild(span);
      p.appendChild(document.createTextNode(" "));
    }
    reader.appendChild(p);
  }
}

// ── Playback ──────────────────────────────────────────────────────
function setHighlight(idx, cls) {
  sentences.forEach((s, i) => {
    s.el.classList.toggle("playing", cls === "playing" && i === idx);
    s.el.classList.toggle("loading", cls === "loading" && i === idx);
  });
}

function stopPlayback() {
  playToken++;
  playing = false;
  audioEl.pause();
  audioEl.src = "";
  playIndex = -1;
  setHighlight(-1);
  if ($("play-status")) $("play-status").textContent = "";
}

async function playFrom(startIdx) {
  stopPlayback();
  const token = ++playToken;
  playing = true;
  const repeatOne = () => $("repeat-chk").checked;

  for (let i = startIdx; i < sentences.length && token === playToken; ) {
    playIndex = i;
    const { text } = sentences[i];
    setHighlight(i, "loading");
    $("play-status").textContent = `${i + 1}/${sentences.length}`;

    let blob;
    try {
      blob = await synthesize(text, engine);
    } catch (err) {
      $("play-status").textContent = `TTS 오류: ${err.message}`;
      stopPlayback();
      return;
    }
    if (token !== playToken) return;

    // Pre-fetch the next sentence while this one plays.
    if (i + 1 < sentences.length)
      synthesize(sentences[i + 1].text, engine).catch(() => {});

    setHighlight(i, "playing");
    sentences[i].el.scrollIntoView({ block: "center", behavior: "smooth" });

    const url = URL.createObjectURL(blob);
    await new Promise((resolve) => {
      audioEl.src = url;
      audioEl.playbackRate = speed;
      audioEl.onended = resolve;
      audioEl.onerror = resolve;
      audioEl.play().catch(resolve);
    });
    URL.revokeObjectURL(url);
    if (token !== playToken) return;

    if (!repeatOne()) i++;
    else await new Promise((r) => setTimeout(r, 400)); // brief gap on repeat
  }
  if (token === playToken) stopPlayback();
}

// ── Bind ──────────────────────────────────────────────────────────
$("load-btn").onclick = () => {
  const text = $("article-text").value.trim();
  if (!text) {
    $("form-status").textContent = "텍스트를 붙여넣어 주세요";
    return;
  }
  const firstSentence = splitParagraphs(text)[0]?.[0] || "Untitled";
  const title =
    $("article-title").value.trim() || firstSentence.slice(0, 40);
  const article = { id: Date.now().toString(36), title, text, ts: Date.now() };
  articles.unshift(article);
  saveArticles();
  $("article-text").value = "";
  $("article-title").value = "";
  openArticle(article.id);
};

$("new-article-btn").onclick = showForm;
$("play-all-btn").onclick = () => playFrom(Math.max(0, playIndex));
$("stop-btn").onclick = stopPlayback;

$("speed-slider").oninput = (e) => {
  speed = parseFloat(e.target.value);
  $("speed-label").textContent = speed.toFixed(2).replace(/0$/, "") + "×";
  audioEl.playbackRate = speed;
};

const engineSel = $("tts-engine");
engineSel.value = engine;
engineSel.onchange = () => {
  engine = engineSel.value;
};

renderList();
