"""Cron entry point — exits early if cron is disabled in cron_state.json."""
import json
import sys
from pathlib import Path

from .config import get_config
from .orchestrator import run_pipeline


def main() -> None:
    config = get_config()
    state_path = Path(config["CRON_STATE_PATH"])

    if state_path.exists():
        try:
            state = json.loads(state_path.read_text())
            if not state.get("enabled", True):
                print("[cron] Disabled — skipping pipeline run.")
                sys.exit(0)
        except Exception as e:
            print(f"[cron] Could not read cron state: {e}. Proceeding anyway.")

    result = run_pipeline(config)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
