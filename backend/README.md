# Gossamer backend

Python package **`gossamer`** (FastAPI + SQLite).

- **Human / AI docs:** start at [../docs/README.md](../docs/README.md) and [../AGENTS.md](../AGENTS.md).
- **Install (editable):** `pip install -e ".[dev]"` from this directory.
- **Run API:** `python -m uvicorn gossamer.app:app --reload --host 127.0.0.1 --port 8000`
- **Tests:** `pytest -q`

Environment variables use the prefix **`GOSSAMER_`** (see [../docs/API.md](../docs/API.md)).
