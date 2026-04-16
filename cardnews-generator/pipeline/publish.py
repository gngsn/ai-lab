import sqlite3
from datetime import datetime, timezone

import httpx


_GRAPH_BASE = "https://graph.facebook.com/v19.0"


def _upload_image(image_path: str, ig_user_id: str, token: str) -> str:
    with open(image_path, "rb") as f:
        resp = httpx.post(
            f"{_GRAPH_BASE}/{ig_user_id}/media",
            params={"access_token": token},
            files={"source": (image_path, f, "image/png")},
            data={"media_type": "IMAGE", "is_carousel_item": "true"},
            timeout=60,
        )
    resp.raise_for_status()
    return resp.json()["id"]


def _create_carousel(media_ids: list[str], caption: str, ig_user_id: str, token: str) -> str:
    resp = httpx.post(
        f"{_GRAPH_BASE}/{ig_user_id}/media",
        params={"access_token": token},
        data={
            "media_type": "CAROUSEL",
            "caption": caption,
            "children": ",".join(media_ids),
        },
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()["id"]


def _publish_container(container_id: str, ig_user_id: str, token: str) -> str:
    resp = httpx.post(
        f"{_GRAPH_BASE}/{ig_user_id}/media_publish",
        params={"access_token": token},
        data={"creation_id": container_id},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()["id"]


def publish_story(story: sqlite3.Row, conn: sqlite3.Connection, config: dict) -> bool:
    token = config["IG_ACCESS_TOKEN"]
    ig_user_id = config["IG_USER_ID"]

    cards = conn.execute(
        "SELECT image_path FROM cards WHERE story_id = ? ORDER BY idx ASC",
        (story["id"],),
    ).fetchall()

    if not cards:
        raise ValueError(f"No rendered cards found for story {story['id']}")

    try:
        media_ids = [
            _upload_image(card["image_path"], ig_user_id, token)
            for card in cards
        ]
        container_id = _create_carousel(media_ids, story["caption"] or "", ig_user_id, token)
        _publish_container(container_id, ig_user_id, token)
    except httpx.HTTPStatusError as e:
        raise RuntimeError(f"IG API error {e.response.status_code}: {e.response.text}") from e

    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        "UPDATE stories SET status = 'published', published_at = ? WHERE id = ?",
        (now, story["id"]),
    )
    conn.commit()
    return True
