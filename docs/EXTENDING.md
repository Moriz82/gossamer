# Extending Gossamer

Follow these patterns so new behavior stays **modular** and discoverable. Prefer **one concern per file** and a **single registration site** per subsystem.

## Add an ingestor

1. Create `backend/gossamer/ingestors/my_format.py`.
2. Subclass **`Ingestor`** (`base.py`):
   - **`name`**: unique snake_case string (used as `ingestor_hint`).
   - **`can_handle(path, mime=None)`**: cheap tests; avoid reading huge files repeatedly.
   - **`ingest(ctx: IngestContext)`**: return `RawObservationBatch` with `RawNode` / `RawEdge` rows.
3. At module bottom: **`register_ingestor(MyIngestor())`**.
4. Import the module in **`ingestors/plugins.py`**.
   - Place the import **earlier or later** intentionally if your format shares extensions with another ingestor.

**Batch content tips**

- Emit **`Host`** and **`Endpoint`** nodes plus **`serves`** for each URL you fully identify.
- Add a **`Source`** node key `ingestor:<name>:<ctx.source_label>` and **`discovered_by`** edges from each endpoint to that source for traceability.
- Reuse existing edge kinds when semantics match (`links_to`, etc.).

## Add a node kind

1. Add `backend/gossamer/graph_types/nodes/my_node.py` with class attributes **`kind = "MyKind"`** and methods:
   - **`stable_id(key: str) -> str`**
   - **`merge_properties(existing, incoming) -> dict`**
   - **`ui_hints() -> dict`** (label, color, searchable field names for clients)
2. Register in **`graph_types/registry.py`** → `NODE_TYPE_DEFS["MyKind"] = MyNode()`.
3. Teach **at least one ingestor** (or post-processing step) to emit `RawNode(kind="MyKind", ...)`.

No change to SQLite schema is required; `kind` and `properties_json` are generic.

## Add an edge kind

1. Add `graph_types/edges/my_edge.py` with **`kind`**, **`stable_id(src_id, dst_id, props)`**, **`merge_properties`**, **`merge_sources`**, **`ui_hints`**.
2. Register in **`EDGE_TYPE_DEFS`** in `registry.py`.
3. Emit **`RawEdge`** rows with matching **`kind`** and correct **`src_kind` / `src_key` / `dst_kind` / `dst_key`** (keys must resolve after normalization).

## Add a normalizer step

1. Implement a small class in `normalizers/` with:
   - **`name`** (snake_case identifier)
   - **`normalize_url_string(url, context) -> str`**
   - Optionally **`normalize_host(host, context) -> str`** if host casing rules differ from URL parsing.
2. Register with **`register_normalizer(step)`** in `normalizers/registry.py` so **`build_chain`** can resolve the step by name.
3. Append the **`name`** to **`Settings.normalizer_order`** default or set **`GOSSAMER_NORMALIZER_ORDER`** at runtime per deployment docs.

## Add a query (Python)

1. Subclass **`QueryProvider`** in `queries/builtins.py` or a new module imported from there.
2. Implement **`run(self, conn: sqlite3.Connection)`** → list of dict rows (SELECT-only, parameterized if you add parameters later).
3. **`register_query(MyQuery())`**.

## Add a query (YAML)

1. Add `backend/gossamer/queries/custom/my_query.yaml`.
2. Fields: **`name`**, **`description`**, **`sql`** (single **SELECT** statement; loader rejects strings containing **`;`**).
3. Restart API (or hot-reload in dev) — `yaml_loader.load_yaml_queries` runs at app **lifespan** startup.

## Frontend

- **Colors and labels** for the graph should stay driven by **`/api/graph-type-registry`** when possible so new Python types automatically describe themselves.
- For large graphs, adjust Cytoscape layout or add filtering in `App.tsx`; keep API contract stable (`/api/graph` shape).

## Tests

- Add **`backend/tests/test_my_ingestor.py`**: build a temp file, call **`run_ingest(..., ingestor_hint="...")`**, assert on batch counts or snapshot.
- Run **`pytest -q`** from `backend/`.
