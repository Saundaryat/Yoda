from app.guardrails import redact_data, redact_pii


def test_redacts_common_pii():
    text = "Email me@example.com, call +1 (212) 555-1212, card 4111 1111 1111 1111"
    redacted = redact_pii(text)
    assert redacted == "Email [EMAIL], call [PHONE], card [CARD]"


def test_redacts_nested_log_data():
    value = {"result": {"owner": "me@example.com"}, "items": ["4111111111111111"]}
    assert redact_data(value) == {"result": {"owner": "[EMAIL]"}, "items": ["[CARD]"]}
