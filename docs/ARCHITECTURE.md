# Architecture

## Purpose

Gossamer ingests heterogeneous web recon outputs (proxy exports, CLI JSON, optional crawl seeds), **normalizes** URLs and host keys, upserts into a **single SQLite graph**, and serves a **JSON snapshot** to a browser UI (Cytoscape).

Design goal: **extension without editing core orchestration** — new sources and graph semantics are added via small registered modules.

## High-level flow

```text
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌──────────────┐
│  Ingestor   │     │  Normalizers │     │ GraphStore  │     │   FastAPI    │
│ (per format)│────▶│  (pipeline)  │────▶│  (SQLite)   │────▶│  /api/graph  │
└─────────────┘     └──────────────┘     └─────────────┘     └──────────────┘
```

1. **Ingestor** reads a file path, returns `RawObservationBatch` (`RawNode`, `RawEdge` lists) with string **keys** used for merging (for example host name, `METHOD|url`).
2. **`_normalize_batch`** in `pipeline.py` runs configurable **normalizer steps** on URL strings and host keys (order from settings).
3. **`persist_batch`** resolves each node key to a **stable id** via the registered **node type** (`stable_id`, `merge_properties`). Edges get ids from **edge type** `stable_id(src_id, dst_id, props)`.
4. **`SqliteGraphStore`** upserts rows; edges keep **`sources_json`** for multi-import provenance.

## Directory map (`backend/gossamer/`)

| Path | Role |
|------|------|
| `app.py` | FastAPI app: routes, CORS, lifespan, loads YAML queries from `queries/custom/`. |
| `config.py` | `Settings` (`GOSSAMER_*` env prefix): DB paths, crawl limits, scope, normalizer order. |
| `pipeline.py` | `run_ingest`, `_normalize_batch`, `persist_batch`, `ingest_and_store`. Imports `ingestors/plugins.py` side effects. |
| `models.py` | Dataclasses: `IngestContext`, `RawNode`, `RawEdge`, `NormalizedNode`, `NormalizedEdge`, batches. |
| `scope.py` | `host_allowed(hostname, scope_hosts)` for crawler and scoped ingest options. |
| `ingestors/` | One module per format; `base.Ingestor`; `registry.register_ingestor`; **`plugins.py` registers all**. |
| `graph_types/` | Per-kind **node** and **edge** classes; `registry.py` exposes `NODE_TYPE_DEFS`, `EDGE_TYPE_DEFS`, `graph_type_registry_payload()`. |
| `normalizers/` | Ordered URL/host transforms; `registry.build_chain(names)`. |
| `graph_store/` | `GraphStore` ABC (future swap, for example Neo4j); **`sqlite_store.SqliteGraphStore`**. |
| `queries/` | `QueryProvider` ABC; `registry`; `builtins.py`; **`yaml_loader.py`** + `queries/custom/*.yaml`. |

## Frontend (`frontend/`)

- Vite dev server proxies `/api` → backend `127.0.0.1:8000` (`vite.config.ts`).
- `App.tsx` fetches `/api/graph-type-registry` (legend metadata from Python type plugins) and `/api/graph` (nodes/edges with labels/colors applied server-side for convenience).

## SQLite schema (conceptual)

- **`nodes`:** `id` (PK), `kind`, `key`, `properties_json`, timestamps.
- **`edges`:** `id` (PK), `src_id`, `dst_id`, `kind`, `properties_json`, `sources_json`, timestamps.
- **Foreign keys** enabled; ingest always inserts/updates **nodes before edges** in `persist_batch`.

## Configuration sources

- Defaults in `config.py`.
- Overrides via environment variables with prefix **`GOSSAMER_`** (see [API.md](API.md)).

## Testing

- `backend/tests/` — pipeline + scope tests; run from `backend/` with `pytest`.
- **Fixtures:** `examples/` are synthetic; do not use production exports in tests committed to git.
