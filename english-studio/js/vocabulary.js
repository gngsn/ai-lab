/**
 * vocabulary.js — look up an English word and get a Korean explanation of
 * its etymology, why it carries that meaning, and how it's actually used.
 *
 * Uses Claude (preferred) or OpenAI (fallback) with structured output, same
 * pattern as writing.js. Results are cached in localStorage per word so
 * re-looking-up a word already searched costs no API call.
 */

import { $, escapeHtml, initNav } from "./common.js";

initNav();

const ANTHROPIC_KEY = window.ANTHROPIC_API_KEY || "";
const OPENAI_KEY = window.OPENAI_API_KEY || "";

const STORAGE_KEY = "english-studio/vocab";
const MAX_HISTORY = 60;

let history = loadHistory(); // [{word, ts, data}], newest first

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}
function saveHistory() {
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

// ── Schema ────────────────────────────────────────────────────────
const WORD_SCHEMA = {
  type: "object",
  properties: {
    word: { type: "string", description: "The normalized headword (lemma form)" },
    ipa: { type: "string", description: "IPA pronunciation, e.g. /səˈspɪʃ.ən/" },
    part_of_speech: {
      type: "array",
      items: { type: "string" },
      description: "e.g. [\"noun\", \"verb\"]",
    },
    core_meaning_ko: {
      type: "string",
      description: "One concise sentence in Korean capturing the gut-level core meaning",
    },
    etymology_ko: {
      type: "string",
      description:
        "2-4 sentences in Korean explaining the word's origin (language, source word) in simple terms",
    },
    roots: {
      type: "array",
      items: {
        type: "object",
        properties: {
          morpheme: { type: "string" },
          origin_ko: { type: "string", description: "e.g. 라틴어, 그리스어, 고대영어" },
          meaning_ko: { type: "string", description: "short Korean meaning of this piece" },
        },
        required: ["morpheme", "origin_ko", "meaning_ko"],
        additionalProperties: false,
      },
      description: "Break the word into its root/prefix/suffix morphemes, 1-4 items",
    },
    meaning_link_ko: {
      type: "string",
      description:
        "2-3 sentences in Korean connecting the etymology to the modern meaning — why the roots ended up meaning this",
    },
    usage_ko: {
      type: "string",
      description:
        "2-4 sentences in Korean on how it's actually used: register/formality, common patterns or collocations, when to prefer it over near-synonyms",
    },
    examples: {
      type: "array",
      items: {
        type: "object",
        properties: {
          en: { type: "string" },
          ko: { type: "string" },
        },
        required: ["en", "ko"],
        additionalProperties: false,
      },
      description: "3 natural example sentences with Korean translation",
    },
    confusions_ko: {
      type: "string",
      description:
        "Korean note on words commonly confused with this one and the nuance difference. Empty string if none notable.",
    },
  },
  required: [
    "word",
    "ipa",
    "part_of_speech",
    "core_meaning_ko",
    "etymology_ko",
    "roots",
    "meaning_link_ko",
    "usage_ko",
    "examples",
    "confusions_ko",
  ],
  additionalProperties: false,
};

function wordPrompt(word) {
  return `You are an English vocabulary tutor for a Korean learner. Explain the English word/phrase below so a learner truly understands it, not just memorizes it.

Word: "${word}"

Give a simple, accurate etymology (where it really comes from — don't invent history), clearly connect that origin to why it means what it means today, explain how it's actually used in real English (register, common patterns), and give 3 natural example sentences. Keep every explanation concise but solid — no fluff, no filler. All prose fields must be in Korean; examples are English with a Korean translation.`;
}

async function claudeLookup(word) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-opus-4-8",
      max_tokens: 2048,
      output_config: {
        format: { type: "json_schema", schema: WORD_SCHEMA },
      },
      messages: [{ role: "user", content: wordPrompt(word) }],
    }),
  });
  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText);
    throw new Error(`Claude ${resp.status}: ${msg.slice(0, 200)}`);
  }
  const data = await resp.json();
  const textBlock = (data.content || []).find((b) => b.type === "text");
  if (!textBlock) throw new Error("Claude returned no text");
  return JSON.parse(textBlock.text);
}

async function openaiLookup(word) {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      response_format: {
        type: "json_schema",
        json_schema: { name: "word_explainer", strict: true, schema: WORD_SCHEMA },
      },
      messages: [{ role: "user", content: wordPrompt(word) }],
    }),
  });
  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText);
    throw new Error(`OpenAI ${resp.status}: ${msg.slice(0, 200)}`);
  }
  const data = await resp.json();
  return JSON.parse(data.choices[0].message.content);
}

// ── Sidebar (recent searches) ───────────────────────────────────────
function renderList(activeWord) {
  const list = $("word-list");
  list.innerHTML = "";
  if (!history.length) {
    list.innerHTML =
      '<div class="side-item" style="cursor:default">아직 찾아본 단어가 없어요</div>';
    return;
  }
  for (const entry of history) {
    const item = document.createElement("div");
    item.className =
      "side-item" + (entry.word === activeWord ? " active" : "");
    item.innerHTML = `<span class="label">${escapeHtml(entry.word)}</span>
      <button class="del" title="삭제">✕</button>`;
    item.addEventListener("click", () => {
      $("word-input").value = entry.word;
      renderResult(entry.data);
      renderList(entry.word);
    });
    item.querySelector(".del").addEventListener("click", (e) => {
      e.stopPropagation();
      history = history.filter((x) => x.word !== entry.word);
      saveHistory();
      renderList(activeWord);
    });
    list.appendChild(item);
  }
}

// ── Render ────────────────────────────────────────────────────────
function renderResult(data) {
  $("vocab-hint").style.display = "none";
  $("vocab-view").style.display = "";

  $("v-word").textContent = data.word;
  $("v-ipa").textContent = data.ipa || "";
  $("v-pos").innerHTML = (data.part_of_speech || [])
    .map((p) => `<span>${escapeHtml(p)}</span>`)
    .join(" ");
  $("v-core").textContent = data.core_meaning_ko || "";
  $("v-etymology").textContent = data.etymology_ko || "";

  $("v-roots").innerHTML = (data.roots || [])
    .map(
      (r) => `<div class="root-chip">
        <div class="morph">${escapeHtml(r.morpheme)}</div>
        <div class="origin">${escapeHtml(r.origin_ko || "")}</div>
        <div class="mean">${escapeHtml(r.meaning_ko || "")}</div>
      </div>`,
    )
    .join("");

  $("v-link").textContent = data.meaning_link_ko || "";
  $("v-usage").textContent = data.usage_ko || "";

  $("v-examples").innerHTML = (data.examples || [])
    .map(
      (ex) => `<div class="example-item">
        <div class="en">${escapeHtml(ex.en)}</div>
        <div class="ko">${escapeHtml(ex.ko)}</div>
      </div>`,
    )
    .join("");

  if (data.confusions_ko && data.confusions_ko.trim()) {
    $("v-confusion-wrap").style.display = "";
    $("v-confusion").textContent = data.confusions_ko;
  } else {
    $("v-confusion-wrap").style.display = "none";
  }
}

// ── Search ────────────────────────────────────────────────────────
async function search() {
  const raw = $("word-input").value.trim();
  if (!raw) return;
  const key = raw.toLowerCase();

  if (!ANTHROPIC_KEY && !OPENAI_KEY) {
    $("vocab-status").textContent =
      "config.local.js에 ANTHROPIC_API_KEY 또는 OPENAI_API_KEY를 설정하세요";
    return;
  }

  const cached = history.find((h) => h.word.toLowerCase() === key);
  if (cached) {
    renderResult(cached.data);
    renderList(cached.word);
    $("vocab-status").textContent = "";
    return;
  }

  const btn = $("search-btn");
  btn.disabled = true;
  $("vocab-status").textContent = ANTHROPIC_KEY
    ? "Claude가 찾아보는 중…"
    : "GPT가 찾아보는 중…";
  try {
    const data = ANTHROPIC_KEY
      ? await claudeLookup(raw)
      : await openaiLookup(raw);
    history = history.filter((h) => h.word.toLowerCase() !== key);
    history.unshift({ word: data.word || raw, ts: Date.now(), data });
    saveHistory();
    renderResult(data);
    renderList(data.word || raw);
    $("vocab-status").textContent = "";
  } catch (err) {
    $("vocab-status").textContent = "오류: " + err.message;
  } finally {
    btn.disabled = false;
  }
}

$("search-btn").onclick = search;
$("word-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") search();
});

renderList(null);
