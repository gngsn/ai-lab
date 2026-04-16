import hashlib
import json
import sqlite3
import uuid
from datetime import datetime, timezone

from .db import get_conn, init_db
from .render import render_story


def create_manual_story(
    title: str,
    body: str,
    *,
    simplified_body: str | None = None,
    key_terms: list[dict] | None = None,
    caption: str | None = None,
    source_url: str = "manual://input",
    config: dict,
    db_path: str | None = None,
) -> dict:
    """Create and render a cardnews story from manually supplied content.

    If simplified_body is omitted, body is used as-is (no LLM required).
    key_terms defaults to an empty list; caption defaults to the title.
    Returns a dict with story_id and list of rendered image_paths.
    """
    init_db(db_path or config["DB_PATH"])
    conn = get_conn(db_path or config["DB_PATH"])

    story_id = hashlib.sha256(
        f"manual:{title}:{datetime.now(timezone.utc).isoformat()}".encode()
    ).hexdigest()

    effective_body = simplified_body or body
    effective_terms = key_terms or []
    effective_caption = caption or title

    conn.execute(
        """
        INSERT INTO stories
            (id, source_url, raw_title, raw_body, simplified_body,
             key_terms, caption, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'rewritten', ?)
        """,
        (
            story_id,
            source_url,
            title,
            body,
            effective_body,
            json.dumps(effective_terms),
            effective_caption,
            datetime.now(timezone.utc).isoformat(),
        ),
    )
    conn.commit()

    row = conn.execute("SELECT * FROM stories WHERE id = ?", (story_id,)).fetchone()
    image_paths = render_story(row, conn, config)
    conn.close()

    return {"story_id": story_id, "image_paths": image_paths}


def rewrite_and_create(
    title: str,
    body: str,
    *,
    config: dict,
    db_path: str | None = None,
) -> dict:
    """Run LLM rewrite on the supplied article then render.
    Falls back to create_manual_story (no LLM) if ANTHROPIC_API_KEY is absent.
    """
    from .llm import active_api_key, chat, default_models
    import json as _json

    if not active_api_key(config):
        return create_manual_story(title, body, config=config, db_path=db_path)

    _, rewrite_model = default_models(config)

    _PROMPT = """\
You are an English writing coach for B1-B2 learners.

Rewrite the article into clear simple English:
- Short sentences (max 20 words)
- Define jargon inline in parentheses
- 150-250 words total

Extract 3-5 key vocabulary items.
Write an Instagram caption: headline + 1 sentence + 5-7 hashtags.

JSON only:
{{
  "simplified_body": "...",
  "key_terms": [{{"term": "...", "definition": "..."}}],
  "caption": "..."
}}

Title: {title}
Body: {body}
"""

    try:
        text = chat(rewrite_model, _PROMPT.format(title=title, body=body[:3000]), 1024, config)
        data = _json.loads(text)
        return create_manual_story(
            title,
            body,
            simplified_body=data.get("simplified_body"),
            key_terms=data.get("key_terms"),
            caption=data.get("caption"),
            config=config,
            db_path=db_path,
        )
    except Exception as e:
        print(f"[manual] LLM rewrite failed ({e}), using raw body.")
        return create_manual_story(title, body, config=config, db_path=db_path)
