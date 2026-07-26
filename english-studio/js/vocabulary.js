/**
 * vocabulary.js — look up an English word and get a Korean explanation of
 * its etymology, why it carries that meaning, and how it's actually used.
 *
 * Three engines, switchable anytime from the toolbar selector:
 *   - claude / openai — cloud, needs an API key, costs money per lookup
 *   - ollama          — free, runs fully locally via `ollama serve`
 *                       (not in docker-compose: Ollama in Docker on macOS
 *                       can't use Apple Silicon GPU acceleration, same
 *                       reason MLX STT runs natively — see README)
 *
 * Results are cached in localStorage per word so re-looking-up a word
 * already searched costs nothing, regardless of engine.
 */

import { $, escapeHtml, initNav } from "./common.js";
import { renderMarkdown } from "./markdown.js";

initNav();

const ANTHROPIC_KEY = window.ANTHROPIC_API_KEY || "";
const OPENAI_KEY = window.OPENAI_API_KEY || "";
const OLLAMA_URL = window.OLLAMA_URL || "http://localhost:11434/api/chat";
const OLLAMA_MODEL = window.OLLAMA_MODEL || "qwen3.5";

let aiEngine =
  window.VOCAB_AI_ENGINE ||
  (ANTHROPIC_KEY ? "claude" : OPENAI_KEY ? "openai" : "ollama");

const STORAGE_KEY = "english-studio/vocab";
const MAX_HISTORY = 60;

let history = loadHistory(); // [{word, ts, markdown}], newest first

function saveHistory() {
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}
function loadHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    // Drop entries from the old fixed-schema format (pre markdown rewrite) —
    // they have no `markdown` string to render and can't be backfilled.
    return parsed.filter((e) => typeof e?.markdown === "string");
  } catch {
    return [];
  }
}

// ── System prompt (adapted from voca-prompt-sample.md) ─────────────
const SYSTEM_PROMPT = `# Role

You are an expert in English etymology, historical linguistics, and language teaching.

Your goal is NOT to define English words like a dictionary. Your goal is to make users deeply understand a word so they never forget it again.

Always explain every word through its origin, historical development, mental imagery, and semantic evolution.

Assume the user is an advanced English learner who enjoys understanding language rather than memorizing it.

# Output Structure

Always follow this order.

## 1. Core Meaning

Start with one simple sentence. Example: "Imminent means 'about to happen very soon.'"

## 2. Etymology

Break the word into its historical roots. Example:

imminent → im- (upon) + minere (to project, overhang) → "to hang over"

Explain every prefix, root, and suffix. Always mention Latin, Greek, Old English, or French whenever relevant. Never skip historical evolution.

## 3. Historical Meaning Development

Explain how the meaning changed through history. Always show the chain, e.g. physical meaning → metaphorical meaning → modern meaning. Make it feel like watching evolution happen.

## 4. Mental Image

Create one vivid visual image. Use a small ASCII diagram wrapped in a triple-backtick code fence whenever possible. The image should make the meaning unforgettable. Example:

\`\`\`
      Rock
█████████
     😨
The rock hangs over your head.
↓
imminent
\`\`\`

## 5. Modern Meanings

Explain every important meaning. For each meaning provide: explanation, nuance, common situations, and at least two natural examples.

## 6. Related Words

Show words from the same root and explain how each evolved differently. Example (cede family): cede, proceed, precede, recede, exceed, succeed, succession. Compare them so the user understands the whole family instead of isolated vocabulary.

## 7. Common Collocations

List the most common combinations (e.g. imminent danger, imminent threat, imminent collapse) as a bullet list, and explain why native speakers use them.

## 8. Similar Words

Compare confusing words. Explain subtle differences. Use a markdown table.

## 9. Memory Trick

End with one memorable sentence, e.g. "Imminent is like standing under a giant rock that could fall at any moment."

# Teaching Style

Never sound like a dictionary — tell the story of the word. Always explain WHY the meaning exists. Prioritize intuition over memorization. Whenever a root appears in many common English words, teach the entire family.

# Formatting

Use markdown with "##" headings for each of the 9 sections above (in order, numbered as shown). Use tables for section 8. Wrap ASCII diagrams in a triple-backtick code fence so they render as a monospace block. Highlight important roots in **bold**. Never skip the etymology. Always make the explanation visual.

# Language

Respond in Korean unless the user requests another language. Keep English example sentences and word forms in English. Explain all nuances in Korean.

# Output rules

Respond with the markdown content only — no preamble like "Here is an explanation of...", no closing remarks outside the 9 sections above.`;

function userTurn(word) {
  return `Explain the English word: "${word}"`;
}

// ── Lookups ──────────────────────────────────────────────────────
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
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userTurn(word) }],
    }),
  });
  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText);
    throw new Error(`Claude ${resp.status}: ${msg.slice(0, 200)}`);
  }
  const data = await resp.json();
  const textBlock = (data.content || []).find((b) => b.type === "text");
  if (!textBlock) throw new Error("Claude returned no text");
  return textBlock.text;
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
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userTurn(word) },
      ],
    }),
  });
  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText);
    throw new Error(`OpenAI ${resp.status}: ${msg.slice(0, 200)}`);
  }
  const data = await resp.json();
  return data.choices[0].message.content;
}

async function ollamaLookup(word) {
  const resp = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userTurn(word) },
      ],
      options: { num_predict: 3072 },
    }),
  });
  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText);
    throw new Error(`Ollama ${resp.status}: ${msg.slice(0, 200)}`);
  }
  const data = await resp.json();
  const content = data.message?.content;
  if (!content) throw new Error("Ollama returned no content");
  return content;
}

const AI_LOOKUPS = { claude: claudeLookup, openai: openaiLookup, ollama: ollamaLookup };
const AI_LABELS = {
  claude: "Claude가",
  openai: "GPT가",
  ollama: `로컬 모델(${OLLAMA_MODEL})이 (다소 시간이 걸릴 수 있어요)`,
};

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
      renderResult(entry.word, entry.markdown);
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
function renderResult(word, markdown) {
  $("vocab-hint").style.display = "none";
  $("vocab-view").style.display = "";
  $("v-word").textContent = word;
  $("v-body").innerHTML = renderMarkdown(markdown);
}

// ── Search ────────────────────────────────────────────────────────
async function search() {
  const raw = $("word-input").value.trim();
  if (!raw) return;
  const key = raw.toLowerCase();

  if (aiEngine === "claude" && !ANTHROPIC_KEY) {
    $("vocab-status").textContent = "config.local.js에 ANTHROPIC_API_KEY를 설정하세요";
    return;
  }
  if (aiEngine === "openai" && !OPENAI_KEY) {
    $("vocab-status").textContent = "config.local.js에 OPENAI_API_KEY를 설정하세요";
    return;
  }

  const cached = history.find((h) => h.word.toLowerCase() === key);
  if (cached) {
    renderResult(cached.word, cached.markdown);
    renderList(cached.word);
    $("vocab-status").textContent = "";
    return;
  }

  const btn = $("search-btn");
  btn.disabled = true;
  $("vocab-status").textContent = `${AI_LABELS[aiEngine]} 찾아보는 중…`;
  try {
    const markdown = await AI_LOOKUPS[aiEngine](raw);
    history = history.filter((h) => h.word.toLowerCase() !== key);
    history.unshift({ word: raw, ts: Date.now(), markdown });
    saveHistory();
    renderResult(raw, markdown);
    renderList(raw);
    $("vocab-status").textContent = "";
  } catch (err) {
    const hint =
      aiEngine === "ollama"
        ? " (Ollama가 꺼져 있나요? 터미널에서 `ollama serve` 실행 후 다시 시도하세요)"
        : "";
    $("vocab-status").textContent = "오류: " + err.message + hint;
  } finally {
    btn.disabled = false;
  }
}

$("search-btn").onclick = search;
$("word-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") search();
});

const aiEngineSel = $("ai-engine");
aiEngineSel.value = aiEngine;
aiEngineSel.onchange = () => {
  aiEngine = aiEngineSel.value;
};

renderList(null);
