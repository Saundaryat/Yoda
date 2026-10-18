import json
from pathlib import Path
from uuid import uuid4

from app.llm import MockLLM

CASES = [
    json.loads(line)
    for line in (Path(__file__).parent / "golden.jsonl").read_text().splitlines()
    if line.strip()
]
llm = MockLLM()
intent_hits = tool_hits = 0
tp = fp = fn = 0
mapping = {"account_balance": "lookup_account", "support_ticket": "create_ticket"}

for case in CASES:
    result = llm.classify(case["message"], str(uuid4()))
    predicted_tool = mapping.get(result.intent)
    predicted_handoff = result.confidence < 0.6 or predicted_tool is None
    intent_hits += result.intent == case["expected_intent"]
    tool_hits += predicted_tool == case["expected_tool"]
    tp += predicted_handoff and case["expected_handoff"]
    fp += predicted_handoff and not case["expected_handoff"]
    fn += not predicted_handoff and case["expected_handoff"]

scores = {
    "intent accuracy": intent_hits / len(CASES),
    "tool correctness": tool_hits / len(CASES),
    "handoff precision": tp / (tp + fp) if tp + fp else 1,
    "handoff recall": tp / (tp + fn) if tp + fn else 1,
}
print("\nMetric                 Score")
print("---------------------  -----")
for name, score in scores.items():
    print(f"{name:<22} {score:>5.0%}")
raise SystemExit(0 if min(scores.values()) >= 0.8 else 1)
