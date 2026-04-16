import json
import sqlite3
from pathlib import Path

from .config import get_config


def get_conn(db_path: str | None = None) -> sqlite3.Connection:
    path = db_path or get_config()["DB_PATH"]
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db(db_path: str | None = None) -> None:
    conn = get_conn(db_path)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS stories (
            id             TEXT PRIMARY KEY,
            source_url     TEXT NOT NULL,
            raw_title      TEXT,
            raw_body       TEXT,
            ranking_score  REAL,
            simplified_body TEXT,
            key_terms      TEXT,
            caption        TEXT,
            status         TEXT NOT NULL DEFAULT 'fetched',
            published_at   TEXT,
            created_at     TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS cards (
            id         TEXT PRIMARY KEY,
            story_id   TEXT NOT NULL REFERENCES stories(id),
            type       TEXT NOT NULL,
            idx        INTEGER NOT NULL,
            content    TEXT,
            image_path TEXT
        );

        CREATE TABLE IF NOT EXISTS runs (
            id               TEXT PRIMARY KEY,
            started_at       TEXT NOT NULL,
            finished_at      TEXT,
            items_fetched    INTEGER DEFAULT 0,
            items_selected   INTEGER DEFAULT 0,
            items_published  INTEGER DEFAULT 0,
            errors           TEXT DEFAULT '[]'
        );
    """)
    conn.commit()
    conn.close()

    _init_cron_state()


def _init_cron_state() -> None:
    cfg = get_config()
    state_path = Path(cfg.get("CRON_STATE_PATH", "data/cron_state.json"))
    state_path.parent.mkdir(parents=True, exist_ok=True)
    if not state_path.exists():
        state_path.write_text(json.dumps({"enabled": True}, indent=2))


if __name__ == "__main__":
    init_db()
    print("DB initialised.")
