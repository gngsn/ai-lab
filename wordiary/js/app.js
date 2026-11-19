import { fontsReady } from "./fonts.js";
import { toBlob, renderDetail, renderPage, renderSet, setPages, measureCard, F, pad2 } from "./card.js";
import { drawArt, COL } from "./draw.js";
import { buildDrawPrompt, cleanDrawing } from "./ai.js";
import { buildCorrectPrompt, buildRefinePrompt, cleanCorrection, sentenceOf } from "./correct.js";
import { cardFromPicks, defaultPicks, pagesOf, itemCount, normalizeCard } from "./cardmodel.js";
import { SAMPLE_SET, SAMPLE_WORK } from "./sample.js";

const use = (name) => (window.claude && window.claude.use) ? window.claude.use(name) : Promise.resolve(null);
const $ = (id) => document.getElementById(id);
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n[k] = v;
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? "" : v);
  }
  n.append(...kids.filter((k) => k !== null && k !== undefined && k !== false));
  return n;
}

const MAX_PICK = 7;
const QUICK = ["더 자연스럽게", "더 짧게", "더 공손하게", "더 들뜬 느낌으로", "사진이랑 같이 보낼 거야", "슬랭 빼고"];
const state = {
  db: null, sample: null, downloads: null,
  entries: [], threads: [], batches: [], threadId: undefined,
  workId: null, local: null,            // local: the example workspace shown when Claude or saving is unavailable
  busy: false, controller: null, drawing: new Set(),
  sel: [], thumbs: new Map(), rendered: new Map(), open: new Set(), confirmDel: null, editing: null,
};

/* ---------------- entries, threads, context ---------------- */
const isDraft = (e) => e.schema === 2 && e.status !== "card";
const hasCard = (e) => !!e.card && !isDraft(e);
const sentOf = (e) => (e.schema === 2 ? sentenceOf(e.versions[e.vi] || e.versions[0], e.which) : (e.card && e.card.en) || "");
function usedCount(e) { return Array.isArray(e.usedIn) ? e.usedIn.length : 0; }

function work() {
  if (state.local) return state.local;
  return state.entries.find((e) => e.id === state.workId) || null;
}
function contextFor(threadId, beforeMs) {
  if (!threadId) return [];
  return state.entries
    .filter((e) => e.threadId === threadId && e.schema === 2 && e.createdAt < beforeMs)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((e) => ({ input: e.input, sent: sentOf(e) }));
}
function currentThreadId() {
  if (state.threadId !== undefined) return state.threadId;
  return state.threads[0] ? state.threads[0].id : null;
}

function renderThreads() {
  const sel = $("thread"); sel.replaceChildren();
  const cur = currentThreadId();
  for (const t of state.threads) sel.append(el("option", { value: t.id, text: t.title || "대화", selected: t.id === cur }));
  sel.append(el("option", { value: "", text: "＋ 새 대화", selected: !cur }));
  sel.disabled = !state.db;
  const n = cur ? contextFor(cur, Infinity).length : 0;
  $("threadNote").textContent = !state.db ? "" : cur
    ? (n ? `이 대화의 앞 문장 ${Math.min(n, 6)}개를 참고해서 고쳐요.` : "이 대화의 첫 문장이에요.")
    : "새 대화로 시작해요. 같은 친구와 이어지는 말은 같은 대화에 넣으면 더 정확해요.";
}

async function ensureThread(text) {
  const cur = currentThreadId();
  if (cur) { state.db.collection("threads").doc(cur).update({ updatedAt: Date.now() }).catch(() => {}); return cur; }
  const ref = state.db.collection("threads").doc();
  const title = text.replace(/\s+/g, " ").trim().slice(0, 24) + (text.trim().length > 24 ? "…" : "");
  await ref.set({ title, createdAt: Date.now(), updatedAt: Date.now() });
  state.threadId = ref.id;
  return ref.id;
}

/* ---------------- Claude calls ---------------- */
function errMsg(e, what) {
  const code = e && e.code;
  return code === "not_granted" ? "Claude 사용을 허용해야 쓸 수 있어요."
    : code === "rate_limited" ? "요청이 많아요. 잠시 후 다시 눌러 주세요."
    : code === "invalid_json" ? "답을 읽지 못했어요. 한 번 더 눌러 주세요."
    : code === "aborted" || (e && e.name === "AbortError") ? "멈췄어요."
    : `${what} 못했어요. 다시 시도해 주세요.`;
}
function setStatus(msg, err = false) {
  const s = $("askStatus"); s.textContent = msg; s.className = "status" + (err ? " err" : "");
}
function setWorkStatus(msg, err = false) {
  const s = $("workStatus"); s.textContent = msg; s.className = "status" + (err ? " err" : "");
}
function setBusy(on, label) {
  state.busy = on;
  $("ask").disabled = on || !state.sample;
  $("refineBtn").disabled = on || !state.sample || !!state.local;
  $("stop").hidden = !on;
  $("askStatus").classList.toggle("pulse", on);
  if (on) setStatus(label);
}

async function ask(ev) {
  ev.preventDefault();
  const text = $("q").value.trim();
  if (!text || state.busy || !state.sample || !state.db) return;
  setBusy(true, "Claude가 고치는 중…");
  state.controller = new AbortController();
  try {
    const threadId = await ensureThread(text);
    const now = Date.now();
    const raw = await state.sample.json(buildCorrectPrompt({ text, context: contextFor(threadId, now) }), { signal: state.controller.signal, cache: false });
    const version = { ...cleanCorrection(raw, text), instruction: "" };
    const ref = state.db.collection("entries").doc();
    const entry = {
      schema: 2, status: "draft", threadId, createdAt: now, input: text.slice(0, 600),
      versions: [version], vi: 0, which: version.recommend, picks: defaultPicks(version), breakAt: 0,
      drawing: null, card: null, usedIn: [],
    };
    await ref.set(entry);
    state.local = null; state.workId = ref.id;
    $("q").value = "";
    setStatus("");
    drawFor(ref.id, version);
    $("work").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    setStatus(errMsg(e, "교정하지"), !(e && e.code === "aborted"));
  } finally { setBusy(false); }
}

async function refine(instruction, clarify = false) {
  const w = work();
  if (!w || state.local || state.busy || !state.sample || !instruction.trim()) return;
  setBusy(true, clarify ? "말한 뜻으로 다시 고치는 중…" : "다듬는 중…");
  setWorkStatus(clarify ? "말한 뜻으로 다시 고치는 중…" : "다듬는 중…");
  state.controller = new AbortController();
  try {
    const current = { ...w.versions[w.vi] }; delete current.instruction;
    const request = clarify ? `What I actually meant: ${instruction}. Redo the whole reply for that meaning.` : instruction;
    const raw = await state.sample.json(buildRefinePrompt({ text: w.input, context: contextFor(w.threadId, w.createdAt), current, instruction: request }), { signal: state.controller.signal, cache: false });
    const version = { ...cleanCorrection(raw, w.input), instruction: (clarify ? "뜻 바로잡기: " : "") + instruction.trim().slice(0, 60) };
    const versions = [...w.versions, version].slice(-8);
    await saveWork({ versions, vi: versions.length - 1, which: version.recommend, picks: defaultPicks(version), breakAt: 0 });
    $("refineText").value = ""; $("clarifyText").value = ""; $("clarify").hidden = true;
    setWorkStatus("");
  } catch (e) {
    setWorkStatus(errMsg(e, "다듬지"), !(e && e.code === "aborted"));
  } finally { setBusy(false); setStatus(""); }
}

/* drawing: the sign for the sentence plus small icons for the expression points; one retry, then the default icon stays */
async function requestDrawing(input) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = cleanDrawing(await state.sample.json(buildDrawPrompt(input), { cache: false }), input.words);
      if (out.signage) return out;
    } catch (e) {
      if (e && (e.code === "not_granted" || e.code === "rate_limited")) throw e;
    }
  }
  return null;
}
async function drawFor(id, version) {
  if (!state.sample || !state.db || state.drawing.has(id)) return;
  state.drawing.add(id); renderWork();
  try {
    const out = await requestDrawing({ sentence: sentenceOf(version, version.recommend), meaning: version.meaningKo, scene: version.scene, words: version.points.map((p) => p.en) });
    if (out) await state.db.collection("entries").doc(id).update({ drawing: out });
    else if (state.workId === id) setWorkStatus("그림을 그리지 못해서 기본 아이콘을 넣었어요. 다시 그리기를 눌러 보세요.", true);
  } catch (e) {
    if (state.workId === id) setWorkStatus(e && e.code === "rate_limited" ? "요청이 많아 그림을 못 그렸어요. 잠시 후 다시 그리기를 눌러 주세요." : "그림을 그리지 못했어요.", true);
  } finally { state.drawing.delete(id); renderWork(); renderEntries(); }
}
// old cards (before the workspace) can still get a drawn sign
async function drawLegacy(e) {
  if (!state.sample || !state.db || state.drawing.has(e.id)) return;
  state.drawing.add(e.id); renderEntries();
  try {
    const out = await requestDrawing({ sentence: e.card.en, meaning: e.card.ko, words: [] });
    if (out) await state.db.collection("entries").doc(e.id).update({ card: { ...e.card, sign: { art: out.signage } } });
    else setStatus("그림을 그리지 못했어요. 다시 시도해 주세요.", true);
  } catch (err) { setStatus("그림을 그리지 못했어요. 다시 시도해 주세요.", true); }
  finally { state.drawing.delete(e.id); renderEntries(); }
}

/* ---------------- workspace ---------------- */
let saveTimer = null, pending = {};
// applies the change right away and writes it once the user pauses
function saveWork(patch, { now = true } = {}) {
  const w = work(); if (!w) return Promise.resolve();
  Object.assign(w, patch);
  renderWork();
  if (state.local || !state.db) return Promise.resolve();
  Object.assign(pending, patch);
  clearTimeout(saveTimer);
  const flush = () => {
    const data = pending; pending = {};
    return state.db.collection("entries").doc(w.id).update(data).catch(() => setWorkStatus("저장하지 못했어요. 다시 시도해 주세요.", true));
  };
  if (now) return flush();
  saveTimer = setTimeout(flush, 500);
  return Promise.resolve();
}

function smallArt(art) {
  const cv = el("canvas", { width: 80, height: 80, "aria-hidden": "true" });
  const ctx = cv.getContext("2d");
  ctx.fillStyle = COL.mint; ctx.fillRect(0, 0, 80, 80);
  drawArt(ctx, art, 8, 8, 64, 14);
  return cv;
}

function pickRow(kind, i, item, checked, art) {
  const id = `pick-${kind}-${i}`;
  const box = el("input", { type: "checkbox", id });
  box.checked = !!checked;
  box.onchange = () => {
    const w = work(); const picks = structuredClone(w.picks);
    if (kind === "bonus") picks.bonus = box.checked; else picks[kind][i] = box.checked;
    saveWork({ picks, breakAt: 0 }, { now: false });
  };
  const text = el("span", {}, el("span", { class: "en", text: item.en }), item.ko ? el("span", { class: "ko", text: item.ko }) : null, item.note ? el("span", { class: "why", text: item.note }) : null);
  return el("li", {}, el("label", { for: id }, box, art ? smallArt(art) : el("span", { class: "noicon" }), text));
}

function drawSignPreview(w) {
  const cv = $("sign"); const ctx = cv.getContext("2d");
  ctx.clearRect(0, 0, cv.width, cv.height);
  const d = w.drawing;
  drawArt(ctx, (d && d.signage) || "chat", 10, 10, cv.width - 20, 9);
}

function renderWork() {
  const w = work();
  $("work").hidden = !w;
  if (!w) { renderDrafts(); return; }
  const v = w.versions[w.vi] || w.versions[0];
  $("workSample").hidden = !state.local;
  $("wInput").textContent = w.input;

  const drawingNow = state.drawing.has(w.id);
  $("drawStatus").textContent = drawingNow ? "Claude가 그리는 중…" : (w.drawing ? "" : "아직 그림이 없어요");
  $("drawStatus").classList.toggle("pulse", drawingNow);
  $("redraw").disabled = drawingNow || !state.sample || !!state.local;
  $("redraw").hidden = !!state.local;
  fontsReady.then(() => drawSignPreview(w));

  const tabs = $("versions"); tabs.replaceChildren();
  if (w.versions.length > 1) w.versions.forEach((ver, i) => {
    const b = el("button", { type: "button", role: "tab", "aria-selected": i === w.vi ? "true" : "false", text: i ? ver.instruction || `다듬기 ${i}` : "처음 교정" });
    b.onclick = () => saveWork({ vi: i, which: ver.recommend, picks: defaultPicks(ver), breakAt: 0 });
    tabs.append(b);
  });

  const pick = () => el("span", { class: "pick-tag", text: "추천" });
  $("rClosest").replaceChildren(v.closest, v.recommend === "closest" && v.natural ? pick() : "");
  $("rNatural").replaceChildren(v.natural, v.recommend === "natural" ? pick() : "");
  $("optNatural").hidden = $("orNatural").hidden = !v.natural;
  $("whichClosest").checked = w.which !== "natural" || !v.natural;
  $("whichNatural").checked = w.which === "natural" && !!v.natural;
  $("rMeaning").textContent = v.meaningKo;
  $("rMeaning").hidden = !v.meaningKo;

  $("coveredWrap").hidden = !v.covered.length;
  $("rCovered").replaceChildren(...v.covered.map((c) => el("li", { text: c })));
  $("assumedWrap").hidden = !v.assumed;
  $("rAssumed").textContent = v.assumed ? "이렇게 이해했어: " + v.assumed : "";
  $("clarifyOpen").hidden = !!state.local;

  const icons = (w.drawing && w.drawing.icons) || {};
  $("pointsWrap").hidden = !v.points.length;
  $("rPoints").replaceChildren(...v.points.map((p, i) => pickRow("points", i, p, w.picks.points[i], icons[p.en])));
  $("altsWrap").hidden = !v.alternatives.length;
  $("rAlts").replaceChildren(...v.alternatives.map((a, i) => pickRow("alternatives", i, a, w.picks.alternatives[i])));
  $("bonusWrap").hidden = !v.bonus;
  $("rBonus").replaceChildren(...(v.bonus ? [pickRow("bonus", 0, v.bonus, w.picks.bonus)] : []));
  $("rRecommend").textContent = v.recommendWhy;

  $("refine").hidden = !!state.local;
  $("refineBtn").disabled = state.busy || !state.sample;
  $("makeCard").textContent = w.status === "card" ? "카드 고치기" : "카드 만들기";
  $("makeCard").disabled = !!state.local || !state.db;
  renderPreview();
  renderDrafts();
}

function currentCard(w) {
  const v = w.versions[w.vi] || w.versions[0];
  const card = cardFromPicks({ version: v, which: w.which, picks: w.picks, drawing: w.drawing });
  if (w.breakAt) card.breakAt = w.breakAt;
  return card;
}

let previewTimer = null, previewUrls = [];
function renderPreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    const w = work(); if (!w) return;
    await fontsReady;
    const card = currentCard(w);
    const total = itemCount(card);
    const fits = measureCard(card).every((m) => m.fits);
    const split = pagesOf(card).length > 1;
    $("overflow").hidden = fits;
    $("splitToggle").hidden = total < 2;
    $("splitToggle").textContent = split ? "한 장으로 합치기" : "두 장으로 나누기";
    $("splitRangeWrap").hidden = !split;
    if (split) {
      const r = $("splitAt"); r.max = String(total - 1); r.value = String(card.breakAt);
      $("splitLabel").textContent = `1장에 항목 ${card.breakAt}개, 2장에 ${total - card.breakAt}개`;
    }
    const blobs = await Promise.all(pagesOf(card).map((pg) => toBlob(renderPage(pg, 0))));
    previewUrls.forEach((u) => URL.revokeObjectURL(u));
    previewUrls = blobs.map((b) => URL.createObjectURL(b));
    $("preview").replaceChildren(...previewUrls.map((u, i) => el("img", { src: u, alt: `카드 미리보기${blobs.length > 1 ? ` ${i + 1}/${blobs.length}` : ""}: ${card.en}` })));
  }, 120);
}

async function makeCard() {
  const w = work(); if (!w || state.local || !state.db) return;
  const card = currentCard(w);
  $("makeCard").disabled = true;
  try {
    await saveWork({ card, status: "card" });
    state.workId = null; renderWork();
    setView("cards");
    $("collectTitle").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) { setWorkStatus("카드를 만들지 못했어요. 다시 시도해 주세요.", true); }
  $("makeCard").disabled = false;
}

function renderDrafts() {
  const box = $("drafts");
  const drafts = state.entries.filter((e) => isDraft(e) && e.id !== state.workId).sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  box.hidden = !drafts.length;
  box.replaceChildren(el("span", { class: "kicker", text: "카드로 안 만든 교정" }), ...drafts.map((e) => {
    const open = el("button", { type: "button", class: "open", text: sentOf(e) || e.input, onclick: () => openWork(e.id) });
    const del = el("button", { type: "button", class: "link danger", text: state.confirmDel === e.id ? "한 번 더 누르면 삭제" : "삭제" });
    del.onclick = async () => {
      if (state.confirmDel !== e.id) { state.confirmDel = e.id; renderDrafts(); return; }
      state.confirmDel = null;
      try { await state.db.collection("entries").doc(e.id).delete(); } catch (err) { setStatus("삭제하지 못했어요. 다시 시도해 주세요.", true); }
    };
    return el("div", { class: "draft" }, open, del);
  }));
}

/* ---------------- card library ---------------- */
// newest cards first; cards already in a card set sink below unused ones
function library() {
  return state.entries.filter(hasCard).sort((a, b) => (usedCount(a) > 0) - (usedCount(b) > 0) || b.createdAt - a.createdAt);
}

function renderDots() {
  const n = library().length;
  $("dots").textContent = n ? String(n) : "";
  $("tabCards").setAttribute("aria-label", `카드 ${n}장`);
}

/* ---------------- menu: 교정 (write and fix) / 카드 (my cards and card sets), kept in the link as #correct or #cards ---------------- */
const VIEWS = { correct: "viewCorrect", cards: "viewCards" };
function setView(name, { push = true } = {}) {
  if (!VIEWS[name]) name = "correct";
  for (const [key, id] of Object.entries(VIEWS)) {
    $(id).hidden = key !== name;
    $(key === "correct" ? "tabCorrect" : "tabCards").setAttribute("aria-selected", key === name ? "true" : "false");
  }
  if (push && location.hash !== "#" + name) {
    try { history.replaceState(null, "", "#" + name); } catch (e) { location.hash = name; }
  }
}
function openWork(id) {
  state.local = null; state.workId = id;
  setView("correct"); renderWork();
  $("work").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderSelection() {
  state.sel = state.sel.filter((id) => state.entries.some((e) => e.id === id && hasCard(e)));
  const n = state.sel.length;
  $("bundleBar").hidden = n === 0 || !state.db;
  $("clearSel").hidden = n === 0;
  $("selCount").textContent = `${n}개 골랐어요` + (n >= MAX_PICK ? " (최대)" : "");
  $("bundle").textContent = `${n}개를 카드뉴스로 묶기`;
  document.querySelectorAll(".pick").forEach((b) => {
    const i = state.sel.indexOf(b.dataset.id);
    b.setAttribute("aria-pressed", i >= 0 ? "true" : "false");
    b.querySelector(".num").textContent = i >= 0 ? String(i + 1) : "+";
  });
}

function thumbFor(e, img) {
  const key = e.id + ":" + JSON.stringify(e.card);
  const hit = state.thumbs.get(key);
  if (hit) { img.src = hit; return; }
  fontsReady.then(() => toBlob(renderDetail(e.card, 0))).then((blob) => {
    const url = URL.createObjectURL(blob);
    state.thumbs.set(key, url); img.src = url;
  });
}

function renderEntries() {
  const list = library();
  const ul = $("entries"); ul.replaceChildren();
  $("entriesEmpty").hidden = list.length > 0;
  for (const e of list) {
    const card = normalizeCard(e.card);
    const li = el("li", { class: "entry" + (state.editing === e.id ? " editing" : "") });
    const pages = pagesOf(e.card).length;
    const pick = el("button", { type: "button", class: "pick", "data-id": e.id, "aria-label": `${card.ko} / ${card.en} 카드 고르기` });
    const img = el("img", { alt: "" }); thumbFor(e, img);
    pick.append(img, el("span", { class: "num", "aria-hidden": "true" }));
    pick.onclick = () => {
      const i = state.sel.indexOf(e.id);
      if (i >= 0) state.sel.splice(i, 1);
      else if (state.sel.length < MAX_PICK) state.sel.push(e.id);
      renderSelection();
    };
    li.append(pick);
    const meta = [pages > 1 ? "2장으로 나눔" : "", usedCount(e) ? `카드뉴스 ${usedCount(e)}개에 들어감` : ""].filter(Boolean).join(" · ");
    if (meta) li.append(el("span", { class: "used", text: meta }));

    const actions = el("div", { class: "row" });
    if (e.schema === 2) {
      actions.append(el("button", { type: "button", class: "link", text: "다시 편집", onclick: () => openWork(e.id) }));
    } else {
      actions.append(el("button", { type: "button", class: "link", text: state.editing === e.id ? "닫기" : "고치기", onclick: () => { state.editing = state.editing === e.id ? null : e.id; renderEntries(); } }));
      const drawing = state.drawing.has(e.id);
      actions.append(el("button", { type: "button", class: "link", text: drawing ? "그리는 중…" : "그림 그리기", disabled: drawing || !state.sample, onclick: () => drawLegacy(e) }));
    }
    const delBtn = el("button", { type: "button", class: "link danger", text: state.confirmDel === e.id ? "한 번 더 누르면 삭제" : "삭제" });
    delBtn.onclick = async () => {
      if (state.confirmDel !== e.id) { state.confirmDel = e.id; renderEntries(); return; }
      state.confirmDel = null;
      try { await state.db.collection("entries").doc(e.id).delete(); } catch (err) { setStatus("삭제하지 못했어요. 다시 시도해 주세요.", true); }
    };
    actions.append(delBtn); li.append(actions);

    if (state.editing === e.id) {
      const form = el("form", { class: "edit" });
      const field = (id, label, value) => { const i = el("input", { id }); i.value = value; form.append(el("label", { for: id, text: label }), i); return i; };
      const koIn = field(`ko-${e.id}`, "카드 맨 위 한국어 문장", e.card.ko);
      const enIn = field(`en-${e.id}`, "영어 문장", e.card.en);
      form.append(el("button", { class: "btn", type: "submit", text: "저장" }));
      form.onsubmit = async (ev) => {
        ev.preventDefault();
        const next = { ...e.card, ko: koIn.value.trim() || e.card.ko, en: enIn.value.trim() || e.card.en };
        try { await state.db.collection("entries").doc(e.id).update({ card: next }); state.editing = null; renderEntries(); }
        catch (err) { setStatus("저장하지 못했어요. 다시 시도해 주세요.", true); }
      };
      li.append(form);
    }
    ul.append(li);
  }
  renderDots();
  renderSelection();
}

/* ---------------- card sets ---------------- */
function fmtDate(ms) { const d = new Date(ms); return `${d.getMonth() + 1}월 ${d.getDate()}일`; }

async function renderBatches(list, { sample = false } = {}) {
  const box = $("batches"); box.replaceChildren();
  if (!list.length) {
    box.append(el("p", { class: "empty", text: "내 카드에서 원하는 카드를 골라 묶으면 카드뉴스가 여기에 생겨요." }));
    return;
  }
  list.forEach((b, bi) => {
    const wrap = el("article", { class: "batch" });
    const title = el("div", { class: "section-title" }, el("h3", { text: `${fmtDate(b.createdAt)} · 표현 ${b.pages.length}개` }));
    if (sample) title.append(el("span", { class: "sample-tag", text: "예시" }));
    wrap.append(title);
    const grid = el("div", { class: "grid" });
    if (!(bi === 0 || state.open.has(b.id))) {
      wrap.append(el("button", { type: "button", class: "ghost", text: "카드 보기", onclick: () => { state.open.add(b.id); renderBatches(list, { sample }); } }));
    } else {
      const loading = el("p", { class: "note pulse", text: "카드 그리는 중…" });
      wrap.append(loading, grid);
      fillGrid(b, grid, loading, wrap);
    }
    box.append(wrap);
  });
}

async function fillGrid(b, grid, loading, wrap) {
  const key = b.id + ":" + (b.updatedAt || b.createdAt);
  let blobs = state.rendered.get(key);
  if (!blobs) { blobs = await renderSet(b.pages); state.rendered.set(key, blobs); }
  loading.remove();
  const stamp = new Date(b.createdAt);
  const base = `cards-${stamp.getFullYear()}${pad2(stamp.getMonth() + 1)}${pad2(stamp.getDate())}`;
  const pages = setPages(b.pages);
  blobs.forEach((blob, i) => {
    const pg = i ? pages[i - 1] : null;
    const alt = i === 0 ? "표지: 한국어 문장 목록" : `${pg.idx}번 표현 카드${pg.page.parts > 1 ? ` (${pg.page.part}/${pg.page.parts})` : ""}: ${pg.page.card.en}`;
    const fig = el("figure", {}, el("img", { src: URL.createObjectURL(blob), alt }));
    if (state.downloads) fig.append(el("button", { type: "button", class: "link", text: "저장", onclick: (ev) => saveFiles([[`${base}-${pad2(i + 1)}.png`, blob]], ev.currentTarget) }));
    grid.append(fig);
  });
  if (state.downloads) {
    wrap.append(el("button", { type: "button", class: "btn", text: `${blobs.length}장 모두 저장`, onclick: (ev) => saveFiles(blobs.map((bl, i) => [`${base}-${pad2(i + 1)}.png`, bl]), ev.currentTarget) }));
  }
}

async function saveFiles(files, btn) {
  const label = btn.textContent;
  btn.disabled = true;
  try {
    for (const [filename, data] of files) await state.downloads.save({ filename, data });
    btn.textContent = "저장했어요";
  } catch (e) {
    btn.textContent = e && e.code === "declined" ? label : "저장할 수 없어요";
  } finally {
    btn.disabled = false;
    setTimeout(() => { btn.textContent = label; }, 2500);
  }
}

async function makeBatch(entries) {
  if (!state.db || !entries.length) return;
  const ref = state.db.collection("batches").doc();
  await ref.set({ createdAt: Date.now(), pages: entries.map((e) => e.card), entryIds: entries.map((e) => e.id) });
  for (const e of entries) {
    await state.db.collection("entries").doc(e.id).update({ usedIn: [...(Array.isArray(e.usedIn) ? e.usedIn : []), ref.id] });
  }
}

/* ---------------- boot ---------------- */
$("composer").addEventListener("submit", ask);
document.querySelectorAll(".tab").forEach((t) => { t.onclick = () => setView(t.dataset.view); });
window.addEventListener("hashchange", () => setView(location.hash.slice(1), { push: false }));
setView(location.hash.slice(1), { push: false });
$("stop").onclick = () => state.controller && state.controller.abort();
$("thread").onchange = () => { state.threadId = $("thread").value || null; renderThreads(); };
$("whichClosest").onchange = () => saveWork({ which: "closest" }, { now: false });
$("whichNatural").onchange = () => saveWork({ which: "natural" }, { now: false });
$("redraw").onclick = () => { const w = work(); if (w) drawFor(w.id, w.versions[w.vi]); };
$("clarifyOpen").onclick = () => { $("clarify").hidden = !$("clarify").hidden; if (!$("clarify").hidden) $("clarifyText").focus(); };
$("clarify").onsubmit = (ev) => { ev.preventDefault(); refine($("clarifyText").value, true); };
$("refine").onsubmit = (ev) => { ev.preventDefault(); refine($("refineText").value); };
$("quick").replaceChildren(...QUICK.map((q) => el("button", { type: "button", text: q, onclick: () => refine(q) })));
$("splitToggle").onclick = () => {
  const w = work(); if (!w) return;
  const total = itemCount(currentCard(w));
  saveWork({ breakAt: w.breakAt ? 0 : Math.ceil(total / 2) }, { now: false });
};
$("splitAt").oninput = () => saveWork({ breakAt: Number($("splitAt").value) }, { now: false });
$("makeCard").onclick = makeCard;
$("closeWork").onclick = () => { state.workId = null; state.local = null; renderWork(); };
$("copy").onclick = () => {
  const w = work(); if (!w) return;
  const t = sentOf(w);
  const done = () => { $("copy").textContent = "복사했어요"; setTimeout(() => ($("copy").textContent = "고른 문장 복사"), 1800); };
  const fallback = () => { const n = $(w.which === "natural" ? "rNatural" : "rClosest"); const r = document.createRange(); r.selectNodeContents(n); const s = getSelection(); s.removeAllRanges(); s.addRange(r); };
  try { navigator.clipboard.writeText(t).then(done).catch(fallback); } catch (e) { fallback(); }
};
$("clearSel").onclick = () => { state.sel = []; renderSelection(); };
$("bundle").onclick = async () => {
  const picked = state.sel.map((id) => state.entries.find((e) => e.id === id)).filter(Boolean);
  if (!picked.length) return;
  $("bundle").disabled = true; $("bundle").textContent = "묶는 중…";
  try {
    await makeBatch(picked);
    state.sel = [];
    $("setsTitle").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) { setStatus("카드뉴스를 만들지 못했어요. 다시 시도해 주세요.", true); }
  $("bundle").disabled = false;
  renderSelection();
};

$("ask").disabled = true;
renderThreads();
renderEntries();
renderBatches([]);
renderWork();

use("sample").then((s) => {
  state.sample = s;
  $("ask").disabled = !s || !state.db;
  if (!s) $("composerNote").textContent = "이 화면에서는 Claude를 쓸 수 없어 교정할 수 없어요. claude.ai에서 열어 주세요.";
  renderWork(); renderEntries();
});
use("downloads").then((d) => { state.downloads = d; if (state.batches.length) renderBatches(state.batches); });
use("db").then((db) => {
  state.db = db;
  $("ask").disabled = !db || !state.sample;
  if (!db) {
    state.local = structuredClone(SAMPLE_WORK);
    renderWork(); renderThreads();
    renderBatches([{ id: "sample", createdAt: Date.now(), pages: SAMPLE_SET }], { sample: true });
    return;
  }
  const timer = setTimeout(() => setStatus("저장된 표현을 불러오는 데 오래 걸려요.", true), 10000);
  db.collection("entries").onSnapshot((snap) => {
    clearTimeout(timer);
    const local = work();
    state.entries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    // keep edits the user made in the last half second from being overwritten by an older snapshot
    if (local && local.id && Object.keys(pending).length) Object.assign(state.entries.find((e) => e.id === local.id) || {}, pending);
    renderEntries(); renderWork(); renderThreads();
  }, () => setStatus("모은 표현을 불러오지 못했어요.", true));
  db.collection("threads").onSnapshot((snap) => {
    state.threads = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    renderThreads();
  }, () => {});
  db.collection("batches").onSnapshot((snap) => {
    clearTimeout(timer);
    const next = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.createdAt - a.createdAt);
    const sig = next.map((b) => b.id + ":" + (b.updatedAt || b.createdAt)).join("|");
    if (sig === state.batchSig) return;
    state.batchSig = sig; state.batches = next;
    renderBatches(next);
  }, () => setStatus("카드뉴스를 불러오지 못했어요.", true));
});
