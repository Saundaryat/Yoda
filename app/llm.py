import json
import time
from dataclasses import dataclass
from typing import Any

from anthropic import Anthropic

from app import config
from app.logging_utils import log_event


@dataclass
class Classification:
    intent: str
    confidence: float
    arguments: dict[str, str]


class MockLLM:
    def __init__(self, mode: str = "mock") -> None:
        self.mode = mode

    def classify(self, message: str, trace_id: str) -> Classification:
        lowered = message.lower()
        if "balance" in lowered:
            customer_id = next((word for word in message.split() if word.upper().startswith("CUST-")), "CUST-001")
            result = Classification("account_balance", 0.95, {"customer_id": customer_id.upper()})
        elif any(word in lowered for word in ("ticket", "help", "problem")):
            result = Classification("support_ticket", 0.9, {"summary": message[:200]})
        else:
            result = Classification("unknown", 0.2, {})
        log_event("llm_call", trace_id, model="mock", latency_ms=0, tokens=0, mode=self.mode)
        return result

    def respond(self, message: str, tool_result: dict[str, Any], trace_id: str) -> str:
        if "balance" in tool_result:
            reply = f"The balance for {tool_result['customer_id']} is ${tool_result['balance']:.2f}."
        else:
            reply = f"I created ticket #{tool_result['ticket_id']}."
        log_event("llm_call", trace_id, model="mock", latency_ms=0, tokens=0, mode=self.mode)
        return reply


class ClaudeProvider:
    def __init__(self) -> None:
        self.client = Anthropic(api_key=config.ANTHROPIC_API_KEY, timeout=config.LLM_TIMEOUT)
        self.mock = MockLLM(mode="fallback")

    def _call(self, model: str, prompt: str, trace_id: str) -> str:
        started = time.perf_counter()
        for attempt in range(3):
            try:
                response = self.client.messages.create(
                    model=model,
                    max_tokens=300,
                    messages=[{"role": "user", "content": prompt}],
                )
                text = response.content[0].text
                log_event(
                    "llm_call", trace_id, model=model,
                    latency_ms=round((time.perf_counter() - started) * 1000),
                    tokens=response.usage.input_tokens + response.usage.output_tokens,
                    mode="live",
                )
                return text
            except Exception as error:
                if attempt == 2:
                    log_event("llm_error", trace_id, model=model, error=type(error).__name__)
        raise RuntimeError("LLM unavailable")

    def classify(self, message: str, trace_id: str) -> Classification:
        if not config.USE_LIVE_LLM or not config.ANTHROPIC_API_KEY:
            return self.mock.classify(message, trace_id)
        prompt = (
            "Return only JSON with intent (account_balance, support_ticket, unknown), "
            f"confidence (0-1), and arguments. User message: {message}"
        )
        try:
            return Classification(**json.loads(self._call(config.MODEL_FAST, prompt, trace_id)))
        except Exception:
            return self.mock.classify(message, trace_id)

    def respond(self, message: str, tool_result: dict[str, Any], trace_id: str) -> str:
        if not config.USE_LIVE_LLM or not config.ANTHROPIC_API_KEY:
            return self.mock.respond(message, tool_result, trace_id)
        prompt = f"Answer briefly using only this tool result: {json.dumps(tool_result)}"
        try:
            return self._call(config.MODEL_STRONG, prompt, trace_id)
        except Exception:
            return self.mock.respond(message, tool_result, trace_id)


def get_llm() -> MockLLM | ClaudeProvider:
    return ClaudeProvider() if config.USE_LIVE_LLM and config.ANTHROPIC_API_KEY else MockLLM()
