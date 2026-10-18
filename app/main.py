from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.agent import run
from app.config import ROOT
from app.db import create_db, engine
from app.logging_utils import recent_logs
from app.models import Conversation, Message


@asynccontextmanager
async def lifespan(_: FastAPI):
    create_db()
    yield


app = FastAPI(title="Interview Agent Skeleton", lifespan=lifespan)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/chat/{conversation_id}")
def chat(conversation_id: str, request: ChatRequest) -> dict:
    return run(conversation_id, request.message)


@app.get("/conversations/{conversation_id}")
def get_conversation(conversation_id: str) -> dict:
    with Session(engine) as session:
        conversation = session.get(Conversation, conversation_id)
        if not conversation:
            raise HTTPException(404, "Conversation not found")
        messages = session.exec(
            select(Message).where(Message.conversation_id == conversation_id).order_by(Message.id)
        ).all()
        return {"conversation": conversation, "messages": messages}


@app.get("/logs")
def logs() -> list[dict]:
    return recent_logs()


app.mount("/", StaticFiles(directory=ROOT / "static", html=True), name="static")

