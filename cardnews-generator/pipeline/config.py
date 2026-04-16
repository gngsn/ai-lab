import os

from dotenv import load_dotenv

load_dotenv()


def get_config() -> dict:
    return {
        "RSS_FEEDS": os.getenv("RSS_FEEDS", ""),
        "TOP_N": int(os.getenv("TOP_N", "3")),
        "RANKING_MODEL": os.getenv("RANKING_MODEL", "claude-haiku-4-5-20251001"),
        "REWRITE_MODEL": os.getenv("REWRITE_MODEL", "claude-sonnet-4-6"),
        "CARD_WIDTH": int(os.getenv("CARD_WIDTH", "1080")),
        "CARD_HEIGHT": int(os.getenv("CARD_HEIGHT", "1080")),
        "OUTPUT_DIR": os.getenv("OUTPUT_DIR", "output"),
        "IG_ACCESS_TOKEN": os.getenv("IG_ACCESS_TOKEN", ""),
        "IG_USER_ID": os.getenv("IG_USER_ID", ""),
        "DB_PATH": os.getenv("DB_PATH", "data/cardnews.db"),
        "CRON_STATE_PATH": os.getenv("CRON_STATE_PATH", "data/cron_state.json"),
        "DASHBOARD_PORT": int(os.getenv("DASHBOARD_PORT", "8000")),
        "ANTHROPIC_API_KEY": os.getenv("ANTHROPIC_API_KEY", ""),
        "GEMINI_API_KEY": os.getenv("GEMINI_API_KEY", ""),
        "GEMINI_RANKING_MODEL": os.getenv("GEMINI_RANKING_MODEL", "gemini-1.5-flash"),
        "GEMINI_REWRITE_MODEL": os.getenv("GEMINI_REWRITE_MODEL", "gemini-1.5-pro"),
    }
