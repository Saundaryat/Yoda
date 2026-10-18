.PHONY: setup seed run test eval reset

setup:
	uv venv --python 3.11 --allow-existing
	uv pip install -r requirements.txt

seed:
	.venv/bin/python -m scripts.seed

run:
	.venv/bin/uvicorn app.main:app --reload

test:
	.venv/bin/python -m pytest -q

eval:
	.venv/bin/python -m evals.run

reset:
	rm -f app.db logs/app.jsonl
	$(MAKE) seed
