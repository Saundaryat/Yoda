from app.guardrails import redact_pii


def test_redacts_common_pii():
    text = "Email me@example.com, call +1 (212) 555-1212, card 4111 1111 1111 1111"
    redacted = redact_pii(text)
    assert "example.com" not in redacted
    assert "555" not in redacted
    assert "4111" not in redacted

