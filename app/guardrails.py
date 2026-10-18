import re
from typing import Any

from app.config import ALLOWED_TOOLS

PATTERNS = (
    (re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I), "[EMAIL]"),
    (re.compile(r"\b(?:\d[ -]*?){16}\b"), "[CARD]"),
    (re.compile(r"(?<!\w)(?:\+?\d[\d .()-]{7,}\d)(?!\w)"), "[PHONE]"),
)


def redact_pii(text: str) -> str:
    for pattern, replacement in PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def redact_data(value: Any) -> Any:
    if isinstance(value, str):
        return redact_pii(value)
    if isinstance(value, list):
        return [redact_data(item) for item in value]
    if isinstance(value, dict):
        return {key: redact_data(item) for key, item in value.items()}
    return value


def is_action_allowed(tool_name: str) -> bool:
    return tool_name in ALLOWED_TOOLS
