import io
import json
import subprocess
import sys
import zipfile
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).parent.parent))
from pipeline.config import get_config
from pipeline.db import get_conn, init_db

app = FastAPI(title="Cardnews Generator Dashboard")
templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))

_running_process: subprocess.Popen | None = None


def _state_path() -> Path:
    return Path(get_config()["CRON_STATE_PATH"])


def _read_state() -> dict:
    p = _state_path()
    if p.exists():
        try:
            return json.loads(p.read_text())
        except Exception:
            pass
    return {"enabled": True}


def _write_state(enabled: bool) -> None:
    p = _state_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"enabled": enabled}, indent=2))


def _is_running() -> bool:
    global _running_process
    if _running_process is None:
        return False
    if _running_process.poll() is None:
        return True
    _running_process = None
    return False


@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request):
    state = _read_state()
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={
            "cron_enabled": state.get("enabled", True),
            "is_running": _is_running(),
        },
    )


@app.post("/cron/enable")
async def cron_enable():
    _write_state(True)
    return {"enabled": True}


@app.post("/cron/disable")
async def cron_disable():
    _write_state(False)
    return {"enabled": False}


@app.post("/run")
async def run_now():
    global _running_process
    if _is_running():
        raise HTTPException(status_code=409, detail="Pipeline already running")

    _running_process = subprocess.Popen(
        [sys.executable, "-m", "pipeline.orchestrator"],
        cwd=str(Path(__file__).parent.parent),
    )
    return {"status": "started", "pid": _running_process.pid}


@app.get("/runs")
async def get_runs():
    config = get_config()
    init_db(config["DB_PATH"])
    conn = get_conn(config["DB_PATH"])
    rows = conn.execute(
        """
        SELECT id, started_at, finished_at, items_fetched,
               items_selected, items_published, errors
        FROM runs ORDER BY started_at DESC LIMIT 20
        """
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


class ManualRequest(BaseModel):
    title: str
    body: str
    simplified_body: Optional[str] = None
    key_terms: Optional[list[dict]] = None
    caption: Optional[str] = None
    use_llm: bool = True


@app.post("/manual")
async def manual_create(req: ManualRequest):
    from pipeline.manual import create_manual_story, rewrite_and_create
    config = get_config()
    try:
        if req.use_llm and config.get("ANTHROPIC_API_KEY"):
            result = rewrite_and_create(req.title, req.body, config=config)
        else:
            result = create_manual_story(
                req.title,
                req.body,
                simplified_body=req.simplified_body,
                key_terms=req.key_terms or [],
                caption=req.caption,
                config=config,
            )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/manual/export/{story_id}")
async def export_story(story_id: str):
    config = get_config()
    output_root = Path(config["OUTPUT_DIR"])
    matches = list(output_root.rglob(f"{story_id}/card_*.png"))
    if not matches:
        raise HTTPException(status_code=404, detail="No rendered cards found for this story")

    story_dir = matches[0].parent
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for png in sorted(story_dir.glob("card_*.png")):
            zf.write(png, png.name)
        caption_file = story_dir / "caption.txt"
        if caption_file.exists():
            zf.write(caption_file, "caption.txt")
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=cardnews-{story_id[:8]}.zip"},
    )


if __name__ == "__main__":
    import uvicorn
    config = get_config()
    uvicorn.run("dashboard.app:app", host="0.0.0.0", port=config["DASHBOARD_PORT"], reload=True)
