/**
 * vocabulary.js — deep-dive English word explainer: etymology, historical
 * meaning shift, a memorable mental image, related word families, and
 * usage — written as free-form teaching markdown (not a fixed schema), per
 * the prompt in voca-prompt-sample.md, and rendered with markdown.js.
 *
 * Three engines, switchable anytime from the toolbar selector:
 *   - claude / openai — cloud, needs an API key, costs money per lookup
 *   - ollama          — free, runs fully locally via `ollama serve`
 *                       (not in docker-compose: Ollama in Docker on macOS
 *                       can't use Apple Silicon GPU acceleration, same
 *                       reason MLX STT runs natively — see README)
 *
 * Results are cached in localStorage per word (instant, this browser only)
 * and, best-effort, in Supabase (`vocab_lookups` table — shared across
 * devices/browsers, and durable across a cleared localStorage). Supabase
 * is checked between the local-cache miss and the AI call, so a lookup
 * already done anywhere never re-runs the AI — worth it especially for the
 * free local Ollama engine, which can take minutes per word.
 *
 * Lookups are async and non-blocking: submitting a search never locks the
 * UI. Multiple words can be in flight at once (tracked in `pending`,
 * keyed by lowercased word); the sidebar shows a spinner per in-flight
 * word, and the main pane only re-renders on completion if the user is
 * still looking at that word (`currentWord`) — finishing a background
 * lookup never yanks the view away from whatever the user is doing. Each
 * in-flight lookup carries an AbortController so dismissing it from the
 * sidebar actually cancels the network request, not just hides it.
 */

import { $, initNav, escapeHtml } from "./common.js";
import { renderMarkdown } from "./markdown.js";
import { getVocabLookup, saveVocabLookup } from "./repo/vocab-repo.js";

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
// word_lower -> { word, engine, status: "loading"|"error", error?, controller }
const pending = new Map();
let currentWord = null; // lowercased word currently shown in the main pane, or null

function saveHistory() {
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}
// Runs before `history` is assigned (called as its own initializer), so it
// must not read or write the `history` binding — write to localStorage
// directly instead of going through saveHistory().
function loadHistory() {
  let parsed;
  try {
    parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
  // Drop entries from the old fixed-schema format (pre markdown rewrite) —
  // they have no `markdown` string to render and can't be backfilled.
  const clean = parsed.filter((e) => typeof e?.markdown === "string");
  if (clean.length !== parsed.length) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
  }
  return clean;
}

// ── System prompt (v2 — English, blockquote/diagram-heavy style) ───
const SYSTEM_PROMPT = `# Role

You are an expert in English etymology and language teaching. Your goal is NOT to define words like a dictionary — make the reader deeply understand a word by tracing it back to its roots, so they never forget it again. Assume the reader is an advanced English learner who enjoys understanding language rather than memorizing it.

# Output structure

Start with this exact 4-line header block, then a line containing only "---":

WORD: <the headword, normal capitalization>
IPA: <IPA pronunciation with slashes, e.g. /ˈɪmɪnənt/>
POS: <part of speech, e.g. "adjective" or "noun, verb">
MEANING: <one short, plain sentence — the core meaning, no markdown formatting>

Then follow this exact structure and order for the rest of the response. Separate every section with a "---" horizontal rule, including right after the opening line.

1. **Opening line** (no heading) — one engaging sentence introducing the word in bold, in the spirit of "**Word** is a great example of a word whose meaning becomes obvious once you know its roots."

2. **"# The origin"** — the headword in bold, then "← Latin/Greek/Old English/French **root-word**". A fenced \`\`\`text code block breaking the word into its morpheme pieces (e.g. "im- + minēre"). A bullet list explaining each piece's original meaning ("* **im-** = on, over, upon"). One sentence on what the word originally, literally described. Then a vivid ASCII scene (fenced \`\`\`text code block, simple box-drawing/emoji) that visualizes that literal original meaning, followed by one sentence connecting the image back to the bolded word.

3. **"# How the meaning developed"** — one sentence framing it as a metaphor shift ("The physical image became a metaphor:"). A blockquote chain showing physical meaning → metaphorical meaning → the word itself, each phrase bold on its own blockquote line, with a bare "↓" on its own blockquote line between each. Then "So **word** means:" followed by a bullet list of 2-3 short synonymous glosses.

4. **"# Examples"** — exactly 3 examples. Each is: a blockquote with the bolded example sentence, a blank line, then one plain-prose paraphrase/explanation sentence, then a "---" divider before the next example.

5. **"# The key image"** — a SECOND, different diagram from the one in "The origin" — this one abstract (e.g. a timeline/axis showing "not here yet, but very close"), in a fenced \`\`\`text code block, followed by one closing sentence.

6. **"# Related word: *X*"** — pick exactly one commonly confused word (similar spelling/sound, different root or meaning — not a same-root derivative). One sentence framing the confusion ("Many English learners confuse these:"). A markdown table with columns Word | Origin | Meaning. Then a bullet list contrasting one example phrase per word ("**An imminent deadline** = ..."). Close with one sentence naming what's different despite the words looking similar.

7. **"# Similar words"** — a bullet list of 3-5 near-synonyms, each with a brief one-line English gloss (not a table, not Korean).

8. **"# One-sentence memory trick"** — a bolded one-line formula ("**Word = "short memorable phrase."**"), then one closing sentence tying that phrase back to the mental image from section 2 or 5.

# Formatting rules

Use "#" (not "##") for every section heading. Separate every section with "---". Use fenced \`\`\`text code blocks for all ASCII diagrams. Bold the target word wherever it appears and bold key roots/morphemes. Use blockquotes (>) for the meaning-development chain and for every example sentence. Never sound like a dictionary entry — tell the story of the word.

# Language

Write in English.

# Output rules

Respond with the markdown content only — no preamble like "Here is an explanation of...", no meta commentary, no closing remarks outside the 8 sections above.

# Worked example

Here is a complete worked example at the exact style, structure, depth, and tone to match, for the word "imminent":

WORD: Imminent
IPA: /ˈɪmɪnənt/
POS: adjective
MEANING: about to happen very soon
---

**Imminent** is a great example of a word whose meaning becomes obvious once you know its roots.

---

# The origin

**imminent**

← Latin **imminēre**

Break it down like this:

\`\`\`text
im- + minēre
\`\`\`

* **im-** = on, over, upon
* **minēre** = to project, jut out, overhang

Originally, it described something that was **hanging over you**.

Imagine standing under a huge rock that's sticking out from a cliff:

\`\`\`text
      🪨
   ________
  /        \\
 /          \\
-------------
      😨
\`\`\`

The rock is **imminent**—it's hanging over your head and could fall at any moment.

---

# How the meaning developed

The physical image became a metaphor:

> **Something hanging over you**
>
> ↓
>
> **Something about to happen**
>
> ↓
>
> **Imminent**

So **imminent** means:

* about to happen
* very near
* impending

---

# Examples

> **A storm is imminent.**

A storm is about to arrive.

---

> **Failure seemed imminent.**

Failure seemed just around the corner.

---

> **The company faces imminent bankruptcy.**

The company is on the verge of bankruptcy.

---

# The key image

Think of something **looming overhead**.

\`\`\`text
Future
|
|   ⚡
|  (very close)
|
NOW
\`\`\`

It's not here **yet**, but it's so close that you can almost feel it.

---

# Related word: *Eminent*

Many English learners confuse these:

| Word         | Origin           | Meaning               |
| ------------ | ---------------- | --------------------- |
| **imminent** | hanging **over** | about to happen       |
| **eminent**  | standing **out** | famous, distinguished |

For example:

* **An imminent deadline** = a deadline that's almost here.
* **An eminent scientist** = a highly respected scientist.

Only one letter is different, but the meanings are completely different.

---

# Similar words

* **impending** = about to happen (often something bad)
* **forthcoming** = coming soon (more neutral)
* **looming** = approaching in a threatening way
* **upcoming** = scheduled to happen soon (everyday English)

---

# One-sentence memory trick

**Imminent = "hanging over your head."**

Once you picture a heavy rock or dark cloud **overhanging** you, it's easy to remember why **imminent** means **"about to happen very soon."**`;

function userTurn(word) {
  return `Explain the English word: "${word}"`;
}

// ── Lookups ──────────────────────────────────────────────────────
// Each takes an optional AbortSignal so an in-flight lookup can be
// cancelled from the sidebar (see `pending` / dismissPending below).
async function claudeLookup(word, signal) {
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
    signal,
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

async function openaiLookup(word, signal) {
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
    signal,
  });
  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText);
    throw new Error(`OpenAI ${resp.status}: ${msg.slice(0, 200)}`);
  }
  const data = await resp.json();
  return data.choices[0].message.content;
}

async function ollamaLookup(word, signal) {
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
    signal,
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
const AI_MODELS = { claude: "claude-opus-4-8", openai: "gpt-4o-mini", ollama: OLLAMA_MODEL };

// ── Sidebar (recent searches + in-flight lookups) ─────────────────
function renderList(activeWordLower) {
  const list = $("word-list");
  list.innerHTML = "";

  const pendingEntries = [...pending.entries()].reverse(); // newest first
  if (!pendingEntries.length && !history.length) {
    list.innerHTML =
      '<div class="side-item" style="cursor:default">아직 찾아본 단어가 없어요</div>';
    return;
  }

  for (const [key, p] of pendingEntries) {
    const item = document.createElement("div");
    item.className =
      "side-item pending" +
      (p.status === "error" ? " has-error" : "") +
      (key === activeWordLower ? " active" : "");
    item.innerHTML = `<span class="spinner">${p.status === "error" ? "⚠️" : "⏳"}</span>
      <span class="label">${escapeHtml(p.word)}</span>
      <button class="del" title="${p.status === "error" ? "지우기" : "취소"}">✕</button>`;
    item.addEventListener("click", () => selectWord(key));
    item.querySelector(".del").addEventListener("click", (e) => {
      e.stopPropagation();
      dismissPending(key);
    });
    list.appendChild(item);
  }

  for (const entry of history) {
    const key = entry.word.toLowerCase();
    const item = document.createElement("div");
    item.className = "side-item" + (key === activeWordLower ? " active" : "");
    item.innerHTML = `<span class="label">${escapeHtml(entry.word)}</span>
      <button class="del" title="삭제">✕</button>`;
    item.addEventListener("click", () => selectWord(key));
    item.querySelector(".del").addEventListener("click", (e) => {
      e.stopPropagation();
      history = history.filter((x) => x.word.toLowerCase() !== key);
      saveHistory();
      if (currentWord === key) {
        currentWord = null;
        setPaneState("idle");
      }
      renderList(currentWord);
    });
    list.appendChild(item);
  }
}

// Cancel (if loading) or clear (if errored) an in-flight entry.
function dismissPending(key) {
  const p = pending.get(key);
  if (!p) return;
  p.controller?.abort();
  pending.delete(key);
  if (currentWord === key) {
    currentWord = null;
    setPaneState("idle");
  }
  renderList(currentWord);
}

// ── Render ────────────────────────────────────────────────────────
// The model is asked to open with a small "WORD: / IPA: / POS: / MEANING:"
// header before a "---", so the hero (word + pronunciation + part of
// speech + a highlighted core-meaning line) can be pulled out separately
// from the free-form markdown body that follows.
function parseFrontmatter(markdown) {
  const m = String(markdown).match(
    /^\s*WORD:\s*(.+?)\n\s*IPA:\s*(.+?)\n\s*POS:\s*(.+?)\n\s*MEANING:\s*(.+?)\n\s*---\s*\n([\s\S]*)$/,
  );
  if (!m) return null;
  const [, word, ipa, pos, meaning, rest] = m;
  return {
    word: word.trim(),
    ipa: ipa.trim(),
    pos: pos.trim(),
    meaning: meaning.trim(),
    rest: rest.trim(),
  };
}

// Exactly one of these panes is visible at a time.
function setPaneState(state) {
  $("vocab-hint").style.display = state === "idle" ? "" : "none";
  $("vocab-loading").style.display = state === "loading" ? "" : "none";
  $("vocab-error").style.display = state === "error" ? "" : "none";
  $("vocab-view").style.display = state === "result" ? "" : "none";
}

function showLoading(word, engine) {
  setPaneState("loading");
  $("loading-word").textContent = word;
  $("loading-engine").textContent = AI_LABELS[engine];
}

function showError(word, message, key, engine) {
  setPaneState("error");
  $("error-word").textContent = word;
  $("error-message").textContent = message;
  $("retry-btn").onclick = () => {
    dismissPending(key);
    $("word-input").value = word;
    search();
  };
}

// Show whatever `wordLower` currently is — cached result, in-flight
// loading state, a past error, or nothing. Never blocks: this only ever
// reads already-available state, it doesn't start or await a lookup.
function selectWord(wordLower) {
  currentWord = wordLower;
  const p = pending.get(wordLower);
  if (p) {
    if (p.status === "error") showError(p.word, p.error, wordLower, p.engine);
    else showLoading(p.word, p.engine);
  } else {
    const cached = history.find((h) => h.word.toLowerCase() === wordLower);
    if (cached) renderResult(cached.word, cached.markdown);
    else setPaneState("idle");
  }
  $("word-input").value = "";
  renderList(wordLower);
}

function renderResult(word, markdown) {
  setPaneState("result");

  const fm = parseFrontmatter(markdown);
  if (fm) {
    $("v-word").textContent = fm.word || word;
    $("v-ipa").textContent = fm.ipa || "";
    $("v-pos").innerHTML = fm.pos
      ? fm.pos
          .split(",")
          .map((p) => `<span>${escapeHtml(p.trim())}</span>`)
          .join(" ")
      : "";
    if (fm.meaning) {
      $("v-core").textContent = fm.meaning;
      $("v-core").style.display = "";
    } else {
      $("v-core").style.display = "none";
    }
    $("v-body").innerHTML = renderMarkdown(fm.rest);
  } else {
    // No frontmatter — either a legacy cached entry (from before this
    // format existed) or a model that didn't follow it. Fall back to
    // showing just the searched word and the full body as-is.
    $("v-word").textContent = word;
    $("v-ipa").textContent = "";
    $("v-pos").innerHTML = "";
    $("v-core").style.display = "none";
    $("v-body").innerHTML = renderMarkdown(markdown);
  }
}

// ── Search ────────────────────────────────────────────────────────
// Non-blocking: kicks a lookup off in the background and returns
// immediately, so the input/sidebar/other pages stay fully usable while
// it runs — never awaited here, never disables the UI.
function search() {
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
  $("vocab-status").textContent = "";

  // Already resolved or already in flight — just switch to it, no new work.
  if (history.some((h) => h.word.toLowerCase() === key) || pending.has(key)) {
    selectWord(key);
    return;
  }

  const controller = new AbortController();
  pending.set(key, { word: raw, engine: aiEngine, status: "loading", controller });
  selectWord(key); // shows the loading state for this word right away
  executeLookup(key, raw, aiEngine, controller); // fire-and-forget
}

async function executeLookup(key, raw, engine, controller) {
  try {
    const remote = await getVocabLookup(key, engine);
    if (!pending.has(key)) return; // dismissed while checking Supabase

    let markdown;
    if (remote) {
      markdown = remote.markdown;
    } else {
      markdown = await AI_LOOKUPS[engine](raw, controller.signal);
      saveVocabLookup(key, engine, markdown, AI_MODELS[engine]); // best-effort
    }
    if (!pending.has(key)) return; // dismissed while the AI was responding

    pending.delete(key);
    history = history.filter((h) => h.word.toLowerCase() !== key);
    history.unshift({ word: raw, ts: Date.now(), markdown });
    saveHistory();
    if (currentWord === key) renderResult(raw, markdown);
    renderList(currentWord);
  } catch (err) {
    if (err.name === "AbortError" || !pending.has(key)) return; // cancelled — no error UI
    const hint =
      engine === "ollama"
        ? " (Ollama가 꺼져 있나요? 터미널에서 `ollama serve` 실행 후 다시 시도하세요)"
        : "";
    pending.set(key, { word: raw, engine, status: "error", error: err.message + hint });
    if (currentWord === key) showError(raw, err.message + hint, key, engine);
    renderList(currentWord);
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

setPaneState("idle");
renderList(null);
