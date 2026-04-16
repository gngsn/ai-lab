import json
import sqlite3

from .llm import chat, default_models


_REWRITE_PROMPT = """\
You are an English writing coach helping B1-B2 level English learners understand tech news.

Rewrite the article below into clear, simple English:
- Use short sentences (max 20 words each)
- Define technical jargon inline in parentheses the first time it appears
- Keep it factual and engaging
- Aim for 150-250 words total

Then extract 3-5 key vocabulary items — words that are important or difficult for B1-B2 learners.

Finally, write an Instagram caption: headline + 1 punchy sentence + 5-7 relevant hashtags.

Respond with JSON only:
{{
  "simplified_body": "<rewritten article>",
  "key_terms": [
    {{"term": "<word>", "definition": "<concise English definition>"}},
    ...
  ],
  "caption": "<IG caption with hashtags>"
}}

Article title: {title}
Article body: {body}
"""


def rewrite(conn: sqlite3.Connection, config: dict) -> int:
    _, rewrite_model = default_models(config)

    stories = conn.execute(
        "SELECT id, raw_title, raw_body FROM stories WHERE status = 'ranked'"
    ).fetchall()

    processed = 0
    for story in stories:
        try:
            text = chat(
                rewrite_model,
                _REWRITE_PROMPT.format(
                    title=story["raw_title"] or "",
                    body=(story["raw_body"] or "")[:3000],
                ),
                1024,
                config,
            )
            data = json.loads(text)
            conn.execute(
                """
                UPDATE stories
                SET simplified_body = ?, key_terms = ?, caption = ?, status = 'rewritten'
                WHERE id = ?
                """,
                (
                    data.get("simplified_body", ""),
                    json.dumps(data.get("key_terms", [])),
                    data.get("caption", ""),
                    story["id"],
                ),
            )
            processed += 1
        except Exception as e:
            print(f"[rewrite] Failed story {story['id']}: {e}")
            conn.execute(
                "UPDATE stories SET status = 'failed' WHERE id = ?",
                (story["id"],),
            )

    conn.commit()
    return processed
