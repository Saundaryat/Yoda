import re

from app.config import ALLOWED_TOOLS

PATTERNS = (
    (re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I), "[EMAIL]"),
    (re.compile(r"(?<!\w)(?:\+?\d[\d .()-]{7,}\d)(?!\w)"), "[PHONE]"),
    (re.compile(r"\b(?:\d[ -]*?){16}\b"), "[CARD]"),
)


def redact_pii(text: str) -> str:
    for pattern, replacement in PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def is_action_allowed(tool_name: str) -> bool:
    return tool_name in ALLOWED_TOOLS

