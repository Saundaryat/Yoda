from datetime import datetime, timezone

from sqlmodel import Field, SQLModel


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Conversation(SQLModel, table=True):
    id: str = Field(primary_key=True)
    status: str = "open"
    created_at: datetime = Field(default_factory=utc_now)


class Message(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    conversation_id: str = Field(index=True)
    role: str
    content: str
    created_at: datetime = Field(default_factory=utc_now)


class Account(SQLModel, table=True):
    customer_id: str = Field(primary_key=True)
    name: str
    balance: float


class Ticket(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    summary: str
    status: str = "open"

