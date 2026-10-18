from collections.abc import Callable
from typing import Any

from sqlmodel import Session

from app.db import engine
from app.models import Account, Ticket

Tool = Callable[..., dict[str, Any]]
REGISTRY: dict[str, dict[str, Any]] = {}


def tool(name: str, description: str, schema: dict[str, Any]):
    def register(function: Tool) -> Tool:
        REGISTRY[name] = {
            "name": name,
            "description": description,
            "input_schema": schema,
            "function": function,
        }
        return function

    return register


@tool(
    "lookup_account",
    "Look up a customer's account balance",
    {"type": "object", "properties": {"customer_id": {"type": "string"}}, "required": ["customer_id"]},
)
def lookup_account(customer_id: str) -> dict[str, Any]:
    with Session(engine) as session:
        account = session.get(Account, customer_id)
        if not account:
            raise ValueError("account not found")
        return {"customer_id": account.customer_id, "name": account.name, "balance": account.balance}


@tool(
    "create_ticket",
    "Create a support ticket",
    {"type": "object", "properties": {"summary": {"type": "string"}}, "required": ["summary"]},
)
def create_ticket(summary: str) -> dict[str, Any]:
    with Session(engine) as session:
        ticket = Ticket(summary=summary)
        session.add(ticket)
        session.commit()
        session.refresh(ticket)
        return {"ticket_id": ticket.id, "status": ticket.status}

