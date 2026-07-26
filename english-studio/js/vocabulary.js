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

// ── System prompt (v2 — English, blockquote/diagram-heavy style) ───
const SYSTEM_PROMPT = `# Role

You are an expert in English etymology and language teaching. Your goal is NOT to define words like a dictionary — make the reader deeply understand a word by tracing it back to its roots, so they never forget it again. Assume the reader is an advanced English learner who enjoys understanding language rather than memorizing it.

# Output structure

Follow this exact structure and order. Separate every section with a "---" horizontal rule, including right after the opening line.

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
