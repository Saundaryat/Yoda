from uuid import uuid4

from sqlmodel import Session

from app.db import engine
from app.guardrails import is_action_allowed, redact_data, redact_pii
from app.llm import get_llm
from app.logging_utils import log_event
from app.models import Conversation, Message
from app.tools import REGISTRY

INTENT_TO_TOOL = {
    "account_balance": "lookup_account",
    "support_ticket": "create_ticket",
}


def run(conversation_id: str, message: str) -> dict:
    trace_id = str(uuid4())
    safe_message = redact_pii(message)
    llm = get_llm()
    classification = llm.classify(safe_message, trace_id)
    tool_name = INTENT_TO_TOOL.get(classification.intent)
    tool_calls = []
    status = "open"

    if classification.confidence < 0.6 or not tool_name:
        status = "needs_human"
        reply = "I’m not confident I can resolve that safely. I’ll hand this to a person."
    elif not is_action_allowed(tool_name):
        status = "needs_human"
        reply = "That action is not enabled. I’ll hand this to a person."
    else:
        try:
            result = REGISTRY[tool_name]["function"](**classification.arguments)
            tool_calls.append({"name": tool_name, "arguments": classification.arguments, "result": result})
            reply = llm.respond(safe_message, result, trace_id)
        except Exception as error:
            status = "needs_human"
            reply = "I couldn’t complete that safely. I’ll hand this to a person."
            log_event("tool_error", trace_id, tool=tool_name, error=type(error).__name__)

    reply = redact_pii(reply)
    with Session(engine) as session:
        conversation = session.get(Conversation, conversation_id) or Conversation(id=conversation_id)
        conversation.status = status
        session.add(conversation)
        session.add(Message(conversation_id=conversation_id, role="user", content=safe_message))
        session.add(Message(conversation_id=conversation_id, role="assistant", content=reply))
        session.commit()
    log_event(
        "agent_run", trace_id, intent=classification.intent,
        status=status, tool_calls=redact_data(tool_calls),
    )
    return {"reply": reply, "status": status, "tool_calls": tool_calls, "trace_id": trace_id}
