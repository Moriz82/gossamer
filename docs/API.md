# HTTP API and configuration

Base URL defaults to `http://127.0.0.1:8000`. The Vite dev server (port 5173) proxies **`/api`** to this backend.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Liveness; returns DB path string. |
| `GET` | `/api/graph-type-registry` | JSON: `nodes`, `edges` maps of `kind` → UI hints (`label`, `color`, `searchable`, …). |
| `GET` | `/api/graph` | Full graph snapshot: `nodes[]`, `edges[]` with enriched `label`/`color` for the UI. |
| `DELETE` | `/api/graph` | Clear all nodes and edges. |
| `POST` | `/api/ingest` | Multipart **`file`** upload; optional query `source_label`, `ingestor_hint`. |
| `POST` | `/api/ingest/path` | JSON body: `path` (server-visible file), `source_label`, optional `ingestor_hint`. |
| `POST` | `/api/ingest/crawl` | JSON: `seeds_file` (`.urlseed`), optional `max_depth`, `max_pages`, `scope_hosts`, `source_label`. |
| `GET` | `/api/queries` | List registered queries: `name`, `description`. |
| `POST` | `/api/queries/{name}/run` | Execute saved query; returns list of row dicts. |
| `POST` | `/api/export/bundle` | Writes zip under exports dir: SQLite file + `manifest.json`. Response JSON includes `path`. |
| `POST` | `/api/import/bundle` | JSON: `zip_path`, optional `replace` (default true). Reopens DB from extracted sqlite. |

## Ingestor hints (`ingestor_hint`)

Use when auto-detection is wrong or you want to force a parser:

| Hint | File patterns / notes |
|------|------------------------|
| `httpx_json` | JSON lines; also some `.json` heuristics |
| `burp_xml` | Burp export XML |
| `zap_json` | ZAP JSON report with `site` / alerts |
| `ffuf_json` | ffuf JSON with `results` |
| `katana_jsonl` | Katana JSON lines with `request.endpoint` |
| `crawl_seed` | `.urlseed` text file: one URL per line |

**Registration order** in `ingestors/plugins.py` affects which ingestor wins when multiple `can_handle()` paths match.

## Example curl

```bash
# Health
curl -s http://127.0.0.1:8000/api/health

# Ingest by path (server must read the file)
curl -s -X POST http://127.0.0.1:8000/api/ingest/path \
  -H 'Content-Type: application/json' \
  -d '{"path":"/absolute/path/to/out.jsonl","source_label":"run1","ingestor_hint":"httpx_json"}'

# List queries
curl -s http://127.0.0.1:8000/api/queries

# Run query
curl -s -X POST http://127.0.0.1:8000/api/queries/all_endpoints/run
```

## Environment variables (`GOSSAMER_*`)

Defined on `Settings` in `config.py`. Common fields:

| Variable | Meaning | Default (conceptual) |
|----------|---------|----------------------|
| `GOSSAMER_DATABASE_PATH` | SQLite file | `./data/graph.sqlite` |
| `GOSSAMER_UPLOADS_DIR` | Uploaded ingest files | `./uploads` |
| `GOSSAMER_EXPORTS_DIR` | Export zips | `./exports` |
| `GOSSAMER_CORS_ORIGINS` | Allowed browser origins (JSON list where supported) | Vite defaults |
| `GOSSAMER_SCOPE_HOSTS` | Host allowlist for crawl (empty = allow all) | `[]` |
| `GOSSAMER_NORMALIZER_ORDER` | Pipeline normalizer names | `lowercase_host`, `collapse_trailing_slash`, `strip_utm` |
| `GOSSAMER_CRAWL_MAX_DEPTH` | BFS depth cap | `3` |
| `GOSSAMER_CRAWL_MAX_PAGES` | Max fetched pages per crawl ingest | `100` |
| `GOSSAMER_CRAWL_TIMEOUT_SECONDS` | HTTP timeout | `15` |
| `GOSSAMER_CRAWL_USER_AGENT` | Crawler UA string | Product default |

Exact parsing of list fields from the environment follows **Pydantic Settings** rules for your installed version; when in doubt, set paths explicitly and rely on code defaults for lists, or pass **`scope_hosts`** in the `/api/ingest/crawl` JSON body.

## OpenAPI

With the server running: `http://127.0.0.1:8000/docs` (Swagger UI).
