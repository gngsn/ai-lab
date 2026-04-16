import json
import uuid
from datetime import datetime, timezone

from .config import get_config
from .db import get_conn, init_db
from .ingest import ingest
from .publish import publish_story
from .rank import rank
from .render import render_story
from .rewrite import rewrite


def run_pipeline(config: dict | None = None) -> dict:
    if config is None:
        config = get_config()

    init_db(config["DB_PATH"])
    conn = get_conn(config["DB_PATH"])

    run_id = str(uuid.uuid4())
    started_at = datetime.now(timezone.utc).isoformat()
    errors: list[dict] = []

    conn.execute(
        "INSERT INTO runs (id, started_at, errors) VALUES (?, ?, '[]')",
        (run_id, started_at),
    )
    conn.commit()

    # Stage 1: Ingest
    try:
        items_fetched = ingest(conn, config)
    except Exception as e:
        items_fetched = 0
        errors.append({"story_id": None, "stage": "ingest", "message": str(e)})

    # Stage 2: Rank
    try:
        items_selected = rank(conn, config)
    except Exception as e:
        items_selected = 0
        errors.append({"story_id": None, "stage": "rank", "message": str(e)})

    # Stage 3: Rewrite
    try:
        rewrite(conn, config)
    except Exception as e:
        errors.append({"story_id": None, "stage": "rewrite", "message": str(e)})

    # Stage 4 & 5: Render + Publish per story
    rewritten = conn.execute(
        "SELECT * FROM stories WHERE status = 'rewritten'"
    ).fetchall()

    items_published = 0
    for story in rewritten:
        try:
            render_story(story, conn, config)
        except Exception as e:
            errors.append({"story_id": story["id"], "stage": "render", "message": str(e)})
            conn.execute("UPDATE stories SET status = 'failed' WHERE id = ?", (story["id"],))
            conn.commit()
            continue

        try:
            publish_story(story, conn, config)
            items_published += 1
        except Exception as e:
            errors.append({"story_id": story["id"], "stage": "publish", "message": str(e)})
            conn.execute("UPDATE stories SET status = 'failed' WHERE id = ?", (story["id"],))
            conn.commit()

    finished_at = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """
        UPDATE runs
        SET finished_at = ?, items_fetched = ?, items_selected = ?,
            items_published = ?, errors = ?
        WHERE id = ?
        """,
        (
            finished_at,
            items_fetched,
            items_selected,
            items_published,
            json.dumps(errors),
            run_id,
        ),
    )
    conn.commit()
    conn.close()

    return {
        "run_id": run_id,
        "items_fetched": items_fetched,
        "items_selected": items_selected,
        "items_published": items_published,
        "errors": errors,
    }


if __name__ == "__main__":
    result = run_pipeline()
    print(json.dumps(result, indent=2))
