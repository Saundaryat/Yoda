def test_balance_happy_path(client):
    response = client.post("/chat/demo", json={"message": "balance for CUST-001"})
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "open"
    assert body["tool_calls"][0]["name"] == "lookup_account"
    assert "$1250.50" in body["reply"]


def test_unknown_intent_hands_off(client):
    body = client.post("/chat/demo", json={"message": "tell me a joke"}).json()
    assert body["status"] == "needs_human"
    assert body["tool_calls"] == []


def test_tool_error_hands_off(client):
    body = client.post("/chat/demo", json={"message": "balance for CUST-404"}).json()
    assert body["status"] == "needs_human"
    assert body["tool_calls"] == []


def test_disallowed_tool_hands_off(client, monkeypatch):
    monkeypatch.setattr("app.guardrails.ALLOWED_TOOLS", {"lookup_account"})
    body = client.post("/chat/demo", json={"message": "create a ticket"}).json()
    assert body["status"] == "needs_human"
    assert body["tool_calls"] == []


def test_conversation_and_logs_are_visible(client):
    client.post("/chat/demo", json={"message": "balance for CUST-001"})
    conversation = client.get("/conversations/demo")
    assert conversation.status_code == 200
    assert len(conversation.json()["messages"]) == 2
    assert client.get("/logs").status_code == 200
