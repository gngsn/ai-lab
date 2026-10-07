#!/usr/bin/env node
// scripts/import.mjs — import a slides HTML + (optional) notes MD into a deck.
//
// Usage:
//   node scripts/import.mjs --deck=<deck_id> --slides=<file.html>
//                          [--notes=<file.md>] [--title="..."] [--dry-run]
//
// Slides format: any HTML file with one or more `<section …>` blocks at the
// top level of <body>/<main>. Each section becomes one slide row.
//   - section_id  ← data-section-id || data-edit-id || slug(data-title) || s-NNN
//   - title       ← data-title || "Slide N"
//   - order       ← document order, 0-based
//   - content     ← the entire <section …>…</section> as raw HTML
// The deck's frame_html is the rest of the document with the contiguous
// section block replaced by `<!-- slides -->` placeholder.
//
// Notes format: Markdown with `---` separators. Top frontmatter (`---…---`)
// is dropped. Each chunk's first `## title` line is stripped (used as a hint
// only); the rest is the note body. Chunks are matched to slides by index.
//
// Config: env SUPABASE_URL/SUPABASE_ANON_KEY, or read from js/config.local.js.
// No npm dependencies (Node 18+, native fetch).

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// ── args ──────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) args[m[1]] = m[2] ?? true;
    else if (a === "-h" || a === "--help") args.help = true;
  }
  return args;
}

function usage(exit = 0) {
  console.log(
    [
      "Usage: node scripts/import.mjs --deck=<deck_id> --slides=<file.html>",
      "                              [--notes=<file.md>] [--title=...] [--dry-run]",
      "",
      "  --deck      deck_id to create or replace",
      "  --slides    path to HTML file with <section> blocks",
      "  --notes     (optional) path to Markdown file with --- separators",
      "  --title     (optional) deck title; defaults to <title> tag or deck_id",
      "  --dry-run   parse + summary, no DB writes",
      "",
      "Env: SUPABASE_URL, SUPABASE_ANON_KEY (else reads js/config.local.js)",
    ].join("\n"),
  );
  process.exit(exit);
}

// ── config ────────────────────────────────────────────────────────
async function loadConfig() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    return {
      url: process.env.SUPABASE_URL,
      key: process.env.SUPABASE_ANON_KEY,
    };
  }
  const cfgPath = path.join(REPO_ROOT, "js/config.local.js");
  let text;
  try {
    text = await readFile(cfgPath, "utf8");
  } catch {
    throw new Error(
      "Set SUPABASE_URL + SUPABASE_ANON_KEY env, or create js/config.local.js " +
        "(copy from js/config.local.js.example).",
    );
  }
  const url = text.match(/window\.SUPABASE_URL\s*=\s*["']([^"']+)["']/)?.[1];
  const key = text.match(/window\.SUPABASE_ANON_KEY\s*=\s*["']([^"']+)["']/)?.[1];
  if (!url || !key) {
    throw new Error("Could not parse SUPABASE_URL/KEY from js/config.local.js");
  }
  return { url, key };
}

// ── HTML parsing ─────────────────────────────────────────────────
// Sections in v4/v5 slides.html are flat (no nesting). The non-greedy match
// safely stops at the first </section>.
function extractSections(html) {
  const sections = [];
  const re = /<section\b([^>]*)>([\s\S]*?)<\/section>/gi;
  let m;
  while ((m = re.exec(html))) {
    sections.push({
      attrs: m[1],
      innerHtml: m[2],
      outerHtml: m[0],
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return sections;
}

function getAttr(attrs, name) {
  const re = new RegExp(
    `\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  );
  const m = attrs.match(re);
  return m ? (m[2] ?? m[3] ?? m[4]) : null;
}

function slugify(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildSlideRecord(section, index, seenIds) {
  const explicit =
    getAttr(section.attrs, "data-section-id") ||
    getAttr(section.attrs, "data-edit-id");
  const title = getAttr(section.attrs, "data-title") || "";
  let id =
    explicit ||
    slugify(title) ||
    `s-${String(index + 1).padStart(3, "0")}`;
  if (seenIds.has(id)) {
    let n = 2;
    while (seenIds.has(`${id}-${String(n).padStart(2, "0")}`)) n++;
    id = `${id}-${String(n).padStart(2, "0")}`;
  }
  seenIds.add(id);
  return {
    section_id: id,
    order: index,
    title: title || `Slide ${index + 1}`,
    content: section.outerHtml,
  };
}

function buildFrameHtml(html, sections) {
  if (sections.length === 0) {
    if (html.includes("<!-- slides -->")) return html;
    // Best effort fallback so the deck still renders.
    if (/<\/body>/i.test(html)) {
      return html.replace(/<\/body>/i, "<!-- slides -->\n</body>");
    }
    return `${html}\n<!-- slides -->\n`;
  }
  const head = html.slice(0, sections[0].start);
  const tail = html.slice(sections[sections.length - 1].end);
  return head + "<!-- slides -->" + tail;
}

function extractDocTitle(html) {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  return m ? m[1].trim() : null;
}

// ── Notes MD parsing (Marp-compatible) ──────────────────────────
// - Drops top YAML/Marp frontmatter (--- … ---).
// - Splits on `---` separator lines (Marp slide divider).
// - Treats the first `## heading` line of each chunk as the title;
//   only if it's literally the first non-empty line, so sub-headings
//   mid-body are preserved in the note content.
function parseNotesMd(md) {
  let body = md.replace(/^﻿/, "");
  body = body.replace(/^---\s*\n[\s\S]*?\n---\s*\n+/, "");
  const chunks = body.split(/^---+[ \t]*$/m);
  return chunks
    .map((c) => c.trim())
    .filter((c) => c.length > 0)
    .map((chunk) => {
      const lines = chunk.split("\n");
      let title = null;
      let start = 0;
      const m = lines[0]?.match(/^##\s+(.+)$/);
      if (m) {
        title = m[1].trim();
        start = 1;
        // skip a single blank separator line if present
        if (lines[start] !== undefined && lines[start].trim() === "") {
          start++;
        }
      }
      return { title, body: lines.slice(start).join("\n").trim() };
    });
}

// ── Supabase via raw REST ────────────────────────────────────────
class Supa {
  constructor(url, key) {
    this.url = url.replace(/\/+$/, "");
    this.headers = {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
  }
  async request(method, path, body, prefer) {
    const res = await fetch(`${this.url}/rest/v1/${path}`, {
      method,
      headers: prefer ? { ...this.headers, Prefer: prefer } : this.headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new Error(
        `${method} /rest/v1/${path} → ${res.status} ${res.statusText}\n${await res.text()}`,
      );
    }
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  upsertDeck(row) {
    return this.request(
      "POST",
      "decks",
      row,
      "resolution=merge-duplicates,return=minimal",
    );
  }
  deleteSlidesForDeck(deckId) {
    return this.request(
      "DELETE",
      `slides?deck_id=eq.${encodeURIComponent(deckId)}`,
      undefined,
      "return=minimal",
    );
  }
  insertSlides(rows) {
    return this.request("POST", "slides", rows, "return=minimal");
  }
  upsertNote(row) {
    return this.request(
      "POST",
      "notes",
      row,
      "resolution=merge-duplicates,return=minimal",
    );
  }
}

// ── main ─────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.deck || !args.slides) usage(args.help ? 0 : 2);

  const slidesPath = path.resolve(process.cwd(), args.slides);
  const html = await readFile(slidesPath, "utf8");
  const sections = extractSections(html);
  const seen = new Set();
  const slideRecords = sections.map((s, i) => buildSlideRecord(s, i, seen));
  const frameHtml = buildFrameHtml(html, sections);
  const docTitle = extractDocTitle(html);
  const title = args.title || docTitle || args.deck;

  let notesRecords = null;
  if (args.notes) {
    const notesPath = path.resolve(process.cwd(), args.notes);
    const md = await readFile(notesPath, "utf8");
    notesRecords = parseNotesMd(md);
  }

  // ── summary ──
  console.log(`Deck:    ${args.deck}`);
  console.log(`Title:   ${title}`);
  console.log(`Frame:   ${(frameHtml.length / 1024).toFixed(1)} KB`);
  console.log(`Slides:  ${slideRecords.length}`);
  const previewN = Math.min(8, slideRecords.length);
  for (let i = 0; i < previewN; i++) {
    const s = slideRecords[i];
    console.log(`  ${String(i + 1).padStart(3)}. ${s.section_id.padEnd(30)} ${s.title}`);
  }
  if (slideRecords.length > previewN) {
    console.log(`  …and ${slideRecords.length - previewN} more`);
  }
  if (notesRecords) {
    console.log(`Notes:   ${notesRecords.length}`);
    if (notesRecords.length !== slideRecords.length) {
      console.warn(
        `  ⚠ count mismatch — will import first ${Math.min(
          notesRecords.length,
          slideRecords.length,
        )}`,
      );
    }
  }

  if (args["dry-run"]) {
    console.log("\n[dry-run] no DB changes.");
    return;
  }

  if (slideRecords.length === 0) {
    throw new Error("No <section> blocks found in slides HTML.");
  }

  const cfg = await loadConfig();
  const supa = new Supa(cfg.url, cfg.key);

  console.log("\n→ upserting deck…");
  await supa.upsertDeck({
    deck_id: args.deck,
    title,
    frame_html: frameHtml,
  });

  console.log("→ deleting existing slides…");
  await supa.deleteSlidesForDeck(args.deck);

  console.log(`→ inserting ${slideRecords.length} slide(s)…`);
  await supa.insertSlides(
    slideRecords.map((s) => ({ ...s, deck_id: args.deck })),
  );

  if (notesRecords && notesRecords.length > 0) {
    const n = Math.min(notesRecords.length, slideRecords.length);
    console.log(`→ upserting ${n} note(s)…`);
    for (let i = 0; i < n; i++) {
      await supa.upsertNote({
        deck_id: args.deck,
        section_id: slideRecords[i].section_id,
        content: notesRecords[i].body,
      });
    }
  }

  console.log(
    `\n✓ done — open ./edit.html?deck=${encodeURIComponent(args.deck)}`,
  );
}

main().catch((err) => {
  console.error("FAIL:", err.message);
  process.exit(1);
});
