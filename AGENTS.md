# Agent instructions: Gossamer

This file helps automated assistants quickly orient to **Gossamer** — a modular, BloodHound-style **web attack-surface graph** (ingest → normalize → SQLite → REST API → React/Cytoscape UI).

## Read first

| Doc | Purpose |
|-----|---------|
| [docs/README.md](docs/README.md) | Documentation index |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Pipeline, modules, request flow |
| [docs/GRAPH_MODEL.md](docs/GRAPH_MODEL.md) | Node kinds, edge kinds, IDs, merge behavior |
| [docs/API.md](docs/API.md) | HTTP routes, env vars, curl examples |
| [docs/EXTENDING.md](docs/EXTENDING.md) | How to add ingestors, types, normalizers, queries |

## Rules when editing

1. **Keep the modular contract.** Business logic belongs in `ingestors/*`, `graph_types/*`, `normalizers/*`, `queries/*`. Avoid stuffing domain rules into `pipeline.py` or `app.py` beyond orchestration.
2. **Register new plugins explicitly.** New ingestor: new file + `register_ingestor(...)` + import line in [`backend/gossamer/ingestors/plugins.py`](backend/gossamer/ingestors/plugins.py). **Order matters** for ambiguous file types (for example ZAP/ffuf before httpx for some `.json` files).
3. **Do not commit sensitive data.** DB files, uploads, real Burp/ZAP exports belong under ignored paths; see [`.gitignore`](.gitignore).
4. **Authorized use only.** Use only in explicitly permitted engagements.

## Key entry points

- **API:** [`backend/gossamer/app.py`](backend/gossamer/app.py)
- **Ingest + normalize + persist:** [`backend/gossamer/pipeline.py`](backend/gossamer/pipeline.py)
- **SQLite store:** [`backend/gossamer/graph_store/sqlite_store.py`](backend/gossamer/graph_store/sqlite_store.py)
- **Type registry (UI metadata):** [`backend/gossamer/graph_types/registry.py`](backend/gossamer/graph_types/registry.py)
- **Frontend:** [`frontend/src/App.tsx`](frontend/src/App.tsx) — calls `/api/graph` and `/api/graph-type-registry`

## Verify after backend changes

```bash
cd backend && source .venv/bin/activate  # if venv exists
pip install -e ".[dev]"
pytest -q
```

After frontend changes:

```bash
cd frontend && npm run build
```

## Stack snapshot

- **Backend:** Python 3.11+, FastAPI, Pydantic settings, SQLite (`PRAGMA foreign_keys = ON`), `httpx` (crawler).
- **Frontend:** Vite, React, Cytoscape; dev server proxies `/api` → `http://127.0.0.1:8000`.
