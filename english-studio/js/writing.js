/**
 * writing.js — grammar check (LanguageTool) plus AI naturalness feedback
 * (Claude preferred, OpenAI fallback).
 *
 * LanguageTool defaults to a local server (self-hosted, no rate limit, text
 * never leaves the machine) but can be switched to the free public API at
 * any time via the toolbar selector — see LT_PRESETS below.
 *
 * Claude is called directly from the browser with the
 * `anthropic-dangerous-direct-browser-access` header — fine here because
 * this is a local, single-user study tool and the key lives only in the
 * gitignored config.local.js.
 */

import { $, escapeHtml, initNav } from "./common.js";

initNav();

const ANTHROPIC_KEY = window.ANTHROPIC_API_KEY || "";
const OPENAI_KEY = window.OPENAI_API_KEY || "";

const LT_PRESETS = {
  local: window.LANGUAGETOOL_LOCAL_URL || "http://localhost:8010/v2/check",
  public: window.LANGUAGETOOL_PUBLIC_URL || "https://api.languagetool.org/v2/check",
};
let ltSource = window.LANGUAGETOOL_SOURCE || "local"; // "local" | "public"

// ── Word count ────────────────────────────────────────────────────
const textEl = $("write-text");
textEl.addEventListener("input", () => {
  const n = (textEl.value.trim().match(/\S+/g) || []).length;
  $("word-count").textContent = `${n} words`;
});

// ── Grammar check (LanguageTool) ──────────────────────────────────
$("grammar-btn").onclick = async () => {
  const text = textEl.value.trim();
  if (!text) return;
  const btn = $("grammar-btn");
  btn.disabled = true;
  $("check-status").textContent = "문법 검사 중…";
  try {
    const resp = await fetch(LT_PRESETS[ltSource], {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ text, language: "en-US" }),
    });
    if (!resp.ok) throw new Error(`LanguageTool ${resp.status}`);
    renderGrammar(text, (await resp.json()).matches || []);
    $("check-status").textContent = "";
  } catch (err) {
    const hint =
      ltSource === "local"
        ? " (로컬 서버가 꺼져 있나요? 상단에서 Public API로 바꿔보세요)"
        : "";
    $("check-status").textContent = "오류: " + err.message + hint;
  } finally {
    btn.disabled = false;
  }
};

function renderGrammar(text, matches) {
  $("feedback-hint").style.display = "none";
  $("grammar-result").style.display = "";
  $("grammar-summary").textContent = matches.length
    ? `${matches.length}개 발견`
    : "발견된 오류 없음 ✓";
  const wrap = $("grammar-issues");
  wrap.innerHTML = "";
  for (const m of matches) {
    const orig = text.slice(m.offset, m.offset + m.length);
    const fix = m.replacements?.[0]?.value ?? "";
    const card = document.createElement("div");
    card.className = "issue-card grammar";
    card.innerHTML = `
      <span class="kind">${escapeHtml(m.rule?.category?.name || "Grammar")}</span>
      <div><span class="orig">${escapeHtml(orig)}</span>${
        fix ? ` → <span class="fix">${escapeHtml(fix)}</span>` : ""
      }</div>
      <div class="why">${escapeHtml(m.message || "")}</div>
      ${fix ? '<button class="btn ok apply">적용</button>' : ""}`;
    if (fix) {
      card.querySelector(".apply").onclick = () => {
        // Re-locate the original text at click time — earlier applies shift offsets.
        const cur = textEl.value;
        const at = cur.indexOf(orig);
        if (at < 0) return;
        textEl.value = cur.slice(0, at) + fix + cur.slice(at + orig.length);
        textEl.dispatchEvent(new Event("input"));
        card.style.opacity = 0.4;
        card.querySelector(".apply").disabled = true;
      };
    }
    wrap.appendChild(card);
  }
}

// ── AI feedback (Claude / OpenAI) ─────────────────────────────────
const FEEDBACK_SCHEMA = {
  type: "object",
  properties: {
    naturalness_score: {
      type: "integer",
      description: "0-100, how natural the English sounds to a native speaker",
    },
    rewritten: {
      type: "string",
      description: "The full text rewritten to sound natural, preserving meaning",
    },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          original: { type: "string" },
          suggestion: { type: "string" },
          kind: {
            type: "string",
            enum: ["grammar", "word-choice", "style", "tone"],
          },
          reason_ko: {
            type: "string",
            description: "Korean explanation of why this change helps",
          },
        },
        required: ["original", "suggestion", "kind", "reason_ko"],
        additionalProperties: false,
      },
    },
    overall_ko: {
      type: "string",
      description: "2-3 sentence overall feedback in Korean, encouraging tone",
    },
  },
  required: ["naturalness_score", "rewritten", "issues", "overall_ko"],
  additionalProperties: false,
};

function feedbackPrompt(text) {
  return `You are an English writing tutor for a Korean learner. Review the text below for grammar and, more importantly, naturalness — would a native speaker actually phrase it this way?

Text to review:
"""
${text}
"""

Rewrite it naturally (keep the writer's meaning and register), list the specific changes with a Korean explanation for each, score naturalness 0-100, and give brief overall feedback in Korean.`;
}

async function claudeFeedback(text) {
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
      output_config: {
        format: { type: "json_schema", schema: FEEDBACK_SCHEMA },
      },
      messages: [{ role: "user", content: feedbackPrompt(text) }],
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

async function openaiFeedback(text) {
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
        json_schema: { name: "writing_feedback", strict: true, schema: FEEDBACK_SCHEMA },
      },
      messages: [{ role: "user", content: feedbackPrompt(text) }],
    }),
  });
  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText);
    throw new Error(`OpenAI ${resp.status}: ${msg.slice(0, 200)}`);
  }
  const data = await resp.json();
  return JSON.parse(data.choices[0].message.content);
}

$("ai-btn").onclick = async () => {
  const text = textEl.value.trim();
  if (!text) return;
  if (!ANTHROPIC_KEY && !OPENAI_KEY) {
    $("check-status").textContent =
      "config.local.js에 ANTHROPIC_API_KEY 또는 OPENAI_API_KEY를 설정하세요";
    return;
  }
  const btn = $("ai-btn");
  btn.disabled = true;
  $("check-status").textContent = ANTHROPIC_KEY
    ? "Claude가 첨삭 중…"
    : "GPT가 첨삭 중…";
  try {
    const fb = ANTHROPIC_KEY
      ? await claudeFeedback(text)
      : await openaiFeedback(text);
    renderAiFeedback(fb);
    $("check-status").textContent = "";
  } catch (err) {
    $("check-status").textContent = "오류: " + err.message;
  } finally {
    btn.disabled = false;
  }
};

// ── LanguageTool source (local ↔ public) ──────────────────────────
const ltSourceSel = $("lt-source");
ltSourceSel.value = ltSource;
ltSourceSel.onchange = () => {
  ltSource = ltSourceSel.value;
};

function renderAiFeedback(fb) {
  $("feedback-hint").style.display = "none";
  $("ai-result").style.display = "";
  const score = fb.naturalness_score ?? 0;
  const color =
    score >= 80 ? "var(--green)" : score >= 55 ? "var(--yellow)" : "var(--red)";
  const scoreEl = $("ai-score");
  scoreEl.textContent = `자연스러움 ${score}/100`;
  scoreEl.style.color = color;

  $("ai-rewrite").textContent = fb.rewritten || "";
  $("ai-overall").textContent = fb.overall_ko || "";

  const wrap = $("ai-issues");
  wrap.innerHTML = "";
  if (!(fb.issues || []).length) {
    wrap.innerHTML = '<div class="hint">고칠 부분이 거의 없어요! 👏</div>';
    return;
  }
  for (const issue of fb.issues) {
    const card = document.createElement("div");
    card.className =
      "issue-card " + (issue.kind === "grammar" ? "grammar" : "style");
    card.innerHTML = `
      <span class="kind">${escapeHtml(issue.kind)}</span>
      <div><span class="orig">${escapeHtml(issue.original)}</span> →
        <span class="fix">${escapeHtml(issue.suggestion)}</span></div>
      <div class="why">${escapeHtml(issue.reason_ko)}</div>`;
    wrap.appendChild(card);
  }
}
