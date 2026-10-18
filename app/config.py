import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).resolve().parents[1]
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{ROOT / 'app.db'}")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
MODEL_FAST = os.getenv("MODEL_FAST", "claude-haiku-4-5")
MODEL_STRONG = os.getenv("MODEL_STRONG", "claude-sonnet-4-5")
LLM_TIMEOUT = float(os.getenv("LLM_TIMEOUT", "10"))
USE_LIVE_LLM = os.getenv("USE_LIVE_LLM", "false").lower() == "true"
ALLOWED_TOOLS = {
    item.strip()
    for item in os.getenv("ALLOWED_TOOLS", "lookup_account,create_ticket").split(",")
    if item.strip()
}
LOG_PATH = Path(os.getenv("LOG_PATH", ROOT / "logs" / "app.jsonl"))

