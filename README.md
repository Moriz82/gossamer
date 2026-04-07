# Gossamer

**Map the fine threads of your attack surface** — a local, BloodHound-inspired **web graph**: ingest Burp, ZAP, httpx, ffuf, Katana, or crawl seeds; normalize; merge into SQLite; explore in a dark-map **Cytoscape** UI.

Named for the **gossamer** of a spider’s web: light, connected, easy to miss until you graph it.

## Documentation (contributors & agents)

- **[AGENTS.md](AGENTS.md)** — rules, entry points, verification commands  
- **[docs/README.md](docs/README.md)** — doc index  
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — pipeline & layout  
- **[docs/GRAPH_MODEL.md](docs/GRAPH_MODEL.md)** — nodes, edges, merging  
- **[docs/API.md](docs/API.md)** — REST API & `GOSSAMER_*` env vars  
- **[docs/EXTENDING.md](docs/EXTENDING.md)** — plugins & ingestors  

## Quick start

**API** (from repo root: `backend/`)

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
mkdir -p ../data ../uploads ../exports
export GOSSAMER_DATABASE_PATH=$PWD/../data/graph.sqlite
export GOSSAMER_UPLOADS_DIR=$PWD/../uploads
export GOSSAMER_EXPORTS_DIR=$PWD/../exports
python -m uvicorn gossamer.app:app --reload --host 127.0.0.1 --port 8000
```

**UI**

```bash
cd frontend
npm install && npm run dev
```

Open **http://127.0.0.1:5173** (Vite proxies `/api` → port 8000). API docs: **http://127.0.0.1:8000/docs**

### Web UI login

The UI uses HTTP Basic auth against the API. Bootstrap defaults (local dev / Docker) are **`gossamer`** / **`gossamer`** unless you set `GOSSAMER_AUTH_USERNAME` and `GOSSAMER_AUTH_PASSWORD`. The login form does **not** pre-fill these; type them manually (or use the **Authorize** button in Swagger with the same values).

After sign-in you can change credentials under **Settings → Credentials** (stored in `data/config/runtime.json` beside the SQLite DB), or **Revert** to environment-only logins.

For automated checks (e.g. `scripts/run-local.sh`), the default user/password above are used in `curl -u gossamer:gossamer …` against `/api/health`.

## Docker

```bash
docker compose up --build
```

## Safety

Use only on systems you are **authorized** to test. Do not commit live exports — see [.gitignore](.gitignore).

## License & lineage

Developed for competition-style **authorized** assessments; evolved from CPTC team tooling into this standalone repo.
