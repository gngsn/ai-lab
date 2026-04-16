#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// CLI entry (before playwright require so --help works without installed deps)
const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--help') {
  console.log('Usage: node render.js <card_spec.json> <output_dir>');
  process.exit(0);
}

const [specPath, outputDir] = args;
if (!specPath || !outputDir) {
  console.error('Error: provide <card_spec.json> and <output_dir>');
  process.exit(1);
}

const { chromium } = require('playwright');

async function renderCards(specPath, outputDir) {
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const { cards, width = 1080, height = 1080 } = spec;

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width, height });

  for (const card of cards) {
    const html = buildHtml(card, width, height);
    await page.setContent(html, { waitUntil: 'networkidle' });
    const imgPath = path.join(outputDir, `card_${card.index}.png`);
    await page.screenshot({ path: imgPath, type: 'png' });
    console.log(`Rendered: ${imgPath}`);
  }

  await browser.close();
}

function buildHtml(card, width, height) {
  const styles = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: ${width}px; height: ${height}px; overflow: hidden;
      font-family: 'Segoe UI', Arial, sans-serif;
      display: flex; align-items: center; justify-content: center;
    }
    .card {
      width: ${width}px; height: ${height}px;
      padding: 72px; display: flex; flex-direction: column;
      justify-content: center; gap: 24px;
    }
    .title { font-size: 52px; font-weight: 800; line-height: 1.15; }
    .body  { font-size: 36px; font-weight: 400; line-height: 1.55; }
    .teaser { font-size: 34px; font-weight: 400; line-height: 1.5; opacity: 0.85; }
    .term  { font-size: 32px; margin-bottom: 16px; }
    .term strong { font-size: 36px; font-weight: 700; }
    .cta   { font-size: 30px; font-weight: 600; opacity: 0.75; }
    .url   { font-size: 24px; opacity: 0.55; word-break: break-all; margin-top: 8px; }
    .badge {
      display: inline-block; padding: 6px 18px; border-radius: 999px;
      font-size: 20px; font-weight: 700; letter-spacing: 1px;
      text-transform: uppercase; margin-bottom: 12px;
    }
  `;

  let inner = '';
  switch (card.type) {
    case 'hook':
      inner = `
        <div class="card" style="background: linear-gradient(135deg,#1a1a2e 0%,#16213e 60%,#0f3460 100%); color:#fff;">
          <span class="badge" style="background:#e94560; color:#fff;">Tech News</span>
          <div class="title">${esc(card.content.title)}</div>
          <div class="teaser">${esc(card.content.teaser)}</div>
        </div>`;
      break;
    case 'body':
      inner = `
        <div class="card" style="background:#f8f9fa; color:#1a1a2e;">
          <div class="body">${esc(card.content.text)}</div>
        </div>`;
      break;
    case 'key_terms':
      const termHtml = (card.content.terms || []).map(t =>
        `<div class="term"><strong>${esc(t.term)}</strong> — ${esc(t.definition)}</div>`
      ).join('');
      inner = `
        <div class="card" style="background:#0f3460; color:#fff;">
          <span class="badge" style="background:#e94560; color:#fff;">Key Terms</span>
          ${termHtml}
        </div>`;
      break;
    case 'source_cta':
      inner = `
        <div class="card" style="background:#1a1a2e; color:#fff; text-align:center; align-items:center;">
          <div class="cta">${esc(card.content.cta)}</div>
          <div class="url">${esc(card.content.source_url)}</div>
        </div>`;
      break;
    default:
      inner = `<div class="card" style="background:#eee;"><div class="body">${esc(JSON.stringify(card.content))}</div></div>`;
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${styles}</style></head><body>${inner}</body></html>`;
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

renderCards(specPath, outputDir).catch(err => {
  console.error('Render failed:', err);
  process.exit(1);
});
