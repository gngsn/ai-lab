import json
import sqlite3

from .llm import chat, default_models


_RANK_PROMPT = """\
You are a news curator for English learners following IT trends.

Score this article on a scale from 0.0 to 1.0 based on:
- IT trend relevance (is this about meaningful tech news?)
- Learner interest (engaging, not too niche)
- English learnability (contains useful vocabulary, not paywalled jargon soup)

Respond with JSON only: {"score": <float 0.0-1.0>, "reason": "<one sentence>"}

Title: {title}
Body (first 500 chars): {body}
"""


def _score_story(model: str, title: str, body: str, config: dict) -> float:
    try:
        text = chat(model, _RANK_PROMPT.format(title=title, body=body[:500]), 64, config)
        data = json.loads(text)
        return float(data.get("score", 0.0))
    except Exception as e:
        print(f"[rank] Scoring failed: {e}")
        return 0.0


def rank(conn: sqlite3.Connection, config: dict) -> int:
    ranking_model, _ = default_models(config)
    top_n = config["TOP_N"]

    stories = conn.execute(
        "SELECT id, raw_title, raw_body FROM stories WHERE status = 'fetched'"
    ).fetchall()

    scored = []
    for story in stories:
        score = _score_story(ranking_model, story["raw_title"] or "", story["raw_body"] or "", config)
        conn.execute(
            "UPDATE stories SET ranking_score = ? WHERE id = ?",
            (score, story["id"]),
        )
        scored.append((story["id"], score))

    conn.commit()

    scored.sort(key=lambda x: x[1], reverse=True)
    selected = scored[:top_n]

    for story_id, _ in selected:
        conn.execute(
            "UPDATE stories SET status = 'ranked' WHERE id = ?",
            (story_id,),
        )

    conn.commit()
    return len(selected)
