import json
import sqlite3
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path


def render_story(story: sqlite3.Row, conn: sqlite3.Connection, config: dict) -> list[str]:
    key_terms = json.loads(story["key_terms"] or "[]")
    simplified_body = story["simplified_body"] or ""

    body_segments = _split_body(simplified_body)

    teaser = simplified_body[:120] + "…" if len(simplified_body) > 120 else simplified_body
    raw_cards = [
        {"type": "hook", "content": {"title": story["raw_title"], "teaser": teaser}},
        *[{"type": "body", "content": {"text": seg}} for seg in body_segments],
        {"type": "key_terms", "content": {"terms": key_terms}},
        {"type": "source_cta", "content": {
            "source_url": story["source_url"],
            "cta": "Follow for daily tech news in simple English!",
        }},
    ]
    cards = [{"type": c["type"], "index": i, "content": c["content"]} for i, c in enumerate(raw_cards)]

    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    output_dir = (Path(config["OUTPUT_DIR"]) / date_str / story["id"]).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    spec_path = output_dir / "card_specs.json"
    spec_path.write_text(json.dumps({
        "cards": cards,
        "width": config["CARD_WIDTH"],
        "height": config["CARD_HEIGHT"],
        "output_dir": str(output_dir),
    }, indent=2))

    renderer_dir = Path(__file__).parent.parent / "renderer"
    result = subprocess.run(
        ["node", "render.js", str(spec_path), str(output_dir)],
        cwd=str(renderer_dir),
        capture_output=True,
        text=True,
        timeout=120,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Renderer failed: {result.stderr}")

    image_paths = []
    for card in cards:
        img_path = output_dir / f"card_{card['index']}.png"
        card_id = str(uuid.uuid4())
        conn.execute(
            """
            INSERT OR REPLACE INTO cards (id, story_id, type, idx, content, image_path)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                card_id,
                story["id"],
                card["type"],
                card["index"],
                json.dumps(card["content"]),
                str(img_path),
            ),
        )
        image_paths.append(str(img_path))

    conn.execute("UPDATE stories SET status = 'rendered' WHERE id = ?", (story["id"],))
    conn.commit()

    caption_path = output_dir / "caption.txt"
    caption_path.write_text(story["caption"] or "")

    return image_paths


def _split_body(body: str, max_chars: int = 280) -> list[str]:
    sentences = [s.strip() for s in body.split(".") if s.strip()]
    segments, current = [], ""
    for sent in sentences:
        candidate = (current + ". " + sent).strip() if current else sent
        if len(candidate) > max_chars and current:
            segments.append(current)
            current = sent
        else:
            current = candidate
    if current:
        segments.append(current)
    return segments or [body[:max_chars]]
