import hashlib
import sqlite3
from datetime import datetime

import feedparser
import httpx
from bs4 import BeautifulSoup


def _story_id(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()


def _scrape_body(url: str, fallback: str) -> str:
    try:
        resp = httpx.get(url, timeout=10, follow_redirects=True)
        soup = BeautifulSoup(resp.text, "lxml")
        for tag in soup(["script", "style", "nav", "footer", "header"]):
            tag.decompose()
        text = soup.get_text(separator=" ", strip=True)
        return text[:8000] if text else fallback
    except Exception:
        return fallback


def ingest(conn: sqlite3.Connection, config: dict) -> int:
    feed_urls = [u.strip() for u in config["RSS_FEEDS"].split(",") if u.strip()]
    added = 0

    for feed_url in feed_urls:
        try:
            feed = feedparser.parse(feed_url)
        except Exception as e:
            print(f"[ingest] Failed to parse {feed_url}: {e}")
            continue

        for entry in feed.entries:
            url = getattr(entry, "link", None)
            if not url:
                continue

            story_id = _story_id(url)
            existing = conn.execute(
                "SELECT id FROM stories WHERE id = ?", (story_id,)
            ).fetchone()
            if existing:
                continue

            title = getattr(entry, "title", "")
            summary = getattr(entry, "summary", "") or getattr(entry, "description", "")
            body = _scrape_body(url, summary)

            conn.execute(
                """
                INSERT INTO stories (id, source_url, raw_title, raw_body, status, created_at)
                VALUES (?, ?, ?, ?, 'fetched', ?)
                """,
                (story_id, url, title, body, datetime.utcnow().isoformat()),
            )
            added += 1

    conn.commit()
    return added
