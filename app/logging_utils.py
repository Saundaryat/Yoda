import json
from datetime import datetime, timezone
from typing import Any

from app.config import LOG_PATH


def log_event(event: str, trace_id: str, **fields: Any) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "event": event,
        "trace_id": trace_id,
        **fields,
    }
    with LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, default=str) + "\n")


def recent_logs(limit: int = 50) -> list[dict[str, Any]]:
    if not LOG_PATH.exists():
        return []
    lines = LOG_PATH.read_text(encoding="utf-8").splitlines()[-limit:]
    return [json.loads(line) for line in lines if line.strip()]

