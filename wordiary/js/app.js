import { fontsReady } from "./fonts.js";
import { toBlob, renderDetail, renderSet, pad2 } from "./card.js";
import { buildPrompt, cleanCard } from "./ai.js";
import { SAMPLE_SET } from "./sample.js";

const use = (name) => (window.claude && window.claude.use) ? window.claude.use(name) : Promise.resolve(null);

/* ---------------- app state + rendering ---------------- */
const $ = (id) => document.getElementById(id);
const state = { db: null, sample: null, downloads: null, entries: [], batches: [], rendered: new Map(), open: new Set(), busy: false, editing: null, confirmDel: null, sel: [], thumbs: new Map() };
const MAX_PICK = 7;

// newest cards first; cards already in a card set sink below unused ones
function library() {
  return [...state.entries].sort((a, b) => (usedCount(a) > 0) - (usedCount(b) > 0) || b.createdAt - a.createdAt);
}
function usedCount(e) { return Array.isArray(e.usedIn) ? e.usedIn.length : 0; }

function renderDots() {
  const box = $("dots"); box.replaceChildren();
  const t = document.createElement("span"); t.textContent = `카드 ${state.entries.length}장`; box.append(t);
}

function renderSelection() {
  state.sel = state.sel.filter((id) => state.entries.some((e) => e.id === id));
  const n = state.sel.length;
  $("bundleBar").hidden = n === 0 || !state.db;
  $("clearSel").hidden = n === 0;
  $("selCount").textContent = `${n}장 골랐어요` + (n >= MAX_PICK ? " (최대)" : "");
  $("bundle").textContent = `${n}장을 카드뉴스로 묶기`;
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
    const li = document.createElement("li"); li.className = "entry" + (state.editing === e.id ? " editing" : "");
    const pick = document.createElement("button"); pick.type = "button"; pick.className = "pick"; pick.dataset.id = e.id;
    pick.setAttribute("aria-label", `${e.card.ko} / ${e.card.en} 카드 고르기`);
    const img = document.createElement("img"); img.alt = ""; thumbFor(e, img);
    const num = document.createElement("span"); num.className = "num"; num.setAttribute("aria-hidden", "true");
    pick.append(img, num);
    pick.onclick = () => {
      const i = state.sel.indexOf(e.id);
      if (i >= 0) state.sel.splice(i, 1);
      else if (state.sel.length < MAX_PICK) state.sel.push(e.id);
      renderSelection();
    };
    li.append(pick);
    if (usedCount(e)) { const u = document.createElement("span"); u.className = "used"; u.textContent = `카드뉴스 ${usedCount(e)}개에 들어감`; li.append(u); }

    const actions = document.createElement("div"); actions.className = "row";
    const editBtn = document.createElement("button"); editBtn.type = "button"; editBtn.className = "link";
    editBtn.textContent = state.editing === e.id ? "닫기" : "고치기";
    editBtn.onclick = () => { state.editing = state.editing === e.id ? null : e.id; renderEntries(); };
    const delBtn = document.createElement("button"); delBtn.type = "button"; delBtn.className = "link danger";
    delBtn.textContent = state.confirmDel === e.id ? "한 번 더 누르면 삭제" : "삭제";
    delBtn.onclick = async () => {
      if (state.confirmDel !== e.id) { state.confirmDel = e.id; renderEntries(); return; }
      state.confirmDel = null;
      try { await state.db.collection("entries").doc(e.id).delete(); } catch (err) { setStatus("삭제하지 못했어요. 다시 시도해 주세요.", true); }
    };
    actions.append(editBtn, delBtn); li.append(actions);

    if (state.editing === e.id) {
      const form = document.createElement("form"); form.className = "edit";
      const mkField = (id, label, value) => {
        const l = document.createElement("label"); l.htmlFor = id; l.textContent = label;
        const i = document.createElement("input"); i.id = id; i.value = value;
        form.append(l, i); return i;
      };
      const koIn = mkField(`ko-${e.id}`, "카드 맨 위 한국어 문장", e.card.ko);
      const enIn = mkField(`en-${e.id}`, "영어 문장", e.card.en);
      const save = document.createElement("button"); save.className = "btn"; save.type = "submit"; save.textContent = "저장";
      form.append(save);
      form.onsubmit = async (ev) => {
        ev.preventDefault();
        const card = { ...e.card, ko: koIn.value.trim() || e.card.ko, en: enIn.value.trim() || e.card.en };
        try { await state.db.collection("entries").doc(e.id).update({ card }); state.editing = null; renderEntries(); }
        catch (err) { setStatus("저장하지 못했어요. 다시 시도해 주세요.", true); }
      };
      li.append(form);
    }
    ul.append(li);
  }
  renderDots();
  renderSelection();
}

function fmtDate(ms) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

async function renderBatches(list, { sample = false } = {}) {
  const box = $("batches"); box.replaceChildren();
  if (!list.length) {
    const p = document.createElement("p"); p.className = "empty";
    p.textContent = "내 카드에서 원하는 카드를 골라 묶으면 카드뉴스가 여기에 생겨요.";
    box.append(p); return;
  }
  list.forEach((b, bi) => {
    const wrap = document.createElement("article"); wrap.className = "batch";
    const title = document.createElement("div"); title.className = "section-title";
    const h = document.createElement("h3"); h.style.fontSize = "16px"; h.style.fontWeight = "800";
    h.textContent = `${fmtDate(b.createdAt)} · 표현 ${b.pages.length}개`;
    title.append(h);
    if (sample) { const tag = document.createElement("span"); tag.className = "sample-tag"; tag.textContent = "예시"; title.append(tag); }
    wrap.append(title);
    const grid = document.createElement("div"); grid.className = "grid";
    const isOpen = bi === 0 || state.open.has(b.id);
    if (!isOpen) {
      const btn = document.createElement("button"); btn.type = "button"; btn.className = "ghost"; btn.textContent = "카드 보기";
      btn.onclick = () => { state.open.add(b.id); renderBatches(list, { sample }); };
      wrap.append(btn);
    } else {
      const loading = document.createElement("p"); loading.className = "note pulse"; loading.textContent = "카드 그리는 중…";
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
  blobs.forEach((blob, i) => {
    const fig = document.createElement("figure");
    const img = document.createElement("img");
    img.src = URL.createObjectURL(blob);
    img.alt = i === 0 ? "표지: 한국어 문장 목록" : `${i}번 표현 카드: ${b.pages[i - 1].en}`;
    fig.append(img);
    if (state.downloads) {
      const btn = document.createElement("button"); btn.type = "button"; btn.className = "link"; btn.textContent = "저장";
      btn.onclick = () => saveFiles([[`${base}-${pad2(i + 1)}.png`, blob]], btn);
      fig.append(btn);
    }
    grid.append(fig);
  });
  if (state.downloads) {
    const all = document.createElement("button"); all.type = "button"; all.className = "btn";
    all.textContent = `${blobs.length}장 모두 저장`;
    all.onclick = () => saveFiles(blobs.map((bl, i) => [`${base}-${pad2(i + 1)}.png`, bl]), all);
    wrap.append(all);
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

function setStatus(msg, err = false) {
  const s = $("askStatus"); s.textContent = msg; s.className = "status" + (err ? " err" : "");
}

function showResult(reply, savedMsg) {
  $("result").hidden = false;
  $("rNatural").textContent = reply.natural || "";
  $("rCasual").textContent = reply.casual || "";
  $("rCasualWrap").hidden = !reply.casual || reply.casual === reply.natural;
  const ul = $("rTips"); ul.replaceChildren();
  for (const t of (Array.isArray(reply.tips) ? reply.tips : []).slice(0, 5)) {
    const li = document.createElement("li");
    if (t.from) { const f = document.createElement("span"); f.className = "from"; f.textContent = t.from; li.append(f, document.createTextNode(" → ")); }
    const to = document.createElement("span"); to.className = "to"; to.textContent = t.to || ""; li.append(to);
    if (t.why) { const w = document.createElement("span"); w.className = "why"; w.textContent = t.why; li.append(w); }
    ul.append(li);
  }
  $("rComment").textContent = reply.comment || "";
  $("rSaved").textContent = savedMsg;
}

let controller = null;
async function ask(ev) {
  ev.preventDefault();
  const text = $("q").value.trim();
  if (!text || state.busy || !state.sample) return;
  state.busy = true; $("ask").disabled = true; $("stop").hidden = false;
  setStatus("Claude가 고치는 중…"); $("askStatus").classList.add("pulse");
  controller = new AbortController();
  try {
    const data = await state.sample.json(buildPrompt(text), { signal: controller.signal, cache: false });
    const reply = data && data.reply ? data.reply : {};
    const card = cleanCard(data && data.card, reply.natural || text);
    let savedMsg = "저장 기능을 쓸 수 없어 이 교정은 카드로 남지 않아요.";
    if (state.db) {
      const ref = state.db.collection("entries").doc();
      await ref.set({ createdAt: Date.now(), input: text.slice(0, 600), reply, card, usedIn: [] });
      savedMsg = "카드로 만들어 내 카드에 넣었어요 ↓";
    }
    showResult(reply, savedMsg);
    $("q").value = "";
    setStatus("");
  } catch (e) {
    const code = e && e.code;
    const msg = code === "not_granted" ? "Claude 사용을 허용해야 교정할 수 있어요."
      : code === "rate_limited" ? "요청이 많아요. 잠시 후 다시 눌러 주세요."
      : code === "invalid_json" ? "답을 읽지 못했어요. 한 번 더 눌러 주세요."
      : code === "aborted" || (e && e.name === "AbortError") ? "멈췄어요."
      : "교정하지 못했어요. 다시 시도해 주세요.";
    setStatus(msg, code !== "aborted");
  } finally {
    state.busy = false; $("ask").disabled = !state.sample; $("stop").hidden = true;
    $("askStatus").classList.remove("pulse");
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
renderDots();
renderEntries();
$("composer").addEventListener("submit", ask);
$("stop").onclick = () => controller && controller.abort();
$("copy").onclick = () => {
  const t = $("rNatural").textContent;
  try {
    navigator.clipboard.writeText(t).then(() => { $("copy").textContent = "복사했어요"; setTimeout(() => ($("copy").textContent = "문장 복사"), 1800); })
      .catch(() => selectText($("rNatural")));
  } catch (e) { selectText($("rNatural")); }
};
function selectText(el) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
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

renderBatches([]);
$("ask").disabled = true;

use("downloads").then((d) => { state.downloads = d; if (state.batches.length) renderBatches(state.batches); });
use("db").then((db) => {
  state.db = db;
  if (!db) { renderBatches([{ id: "sample", createdAt: Date.now(), pages: SAMPLE_SET }], { sample: true }); return; }
  const timer = setTimeout(() => setStatus("저장된 표현을 불러오는 데 오래 걸려요.", true), 10000);
  db.collection("entries").onSnapshot((snap) => {
    clearTimeout(timer);
    state.entries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderEntries();
  }, () => setStatus("모은 표현을 불러오지 못했어요.", true));
  db.collection("batches").onSnapshot((snap) => {
    clearTimeout(timer);
    const next = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.createdAt - a.createdAt);
    const sig = next.map((b) => b.id + ":" + (b.updatedAt || b.createdAt)).join("|");
    if (sig === state.batchSig) return;
    state.batchSig = sig; state.batches = next;
    renderBatches(next);
  }, () => setStatus("카드뉴스를 불러오지 못했어요.", true));
});

