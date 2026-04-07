# Graph model

## Node kinds (current)

Defined in Python modules under `backend/gossamer/graph_types/nodes/` and registered in `graph_types/registry.py`.

| Kind | Merge key (concept) | Typical `properties` | Notes |
|------|---------------------|----------------------|--------|
| `Host` | Lowercase hostname | `hostname` | One node per scoped host label. |
| `Endpoint` | `METHOD|normalized_url` | `url`, `method`, `status_code`, optional `title`, `webserver`, `technologies`, … | Primary observable for web surface. |
| `Source` | `ingestor:<name>:<source_label>` | `name`, `ingestor` | Provenance anchor for an import batch. |

### Stable node IDs

- Implemented per kind as **`NodeTypeDef.stable_id(key) -> str`** (hash-based prefixes like `host:…`, `endpoint:…`, `source:…`).
- **Do not depend on raw URLs as primary keys in SQLite**; the `key` column stores the merge string, `id` stores the stable id.

## Edge kinds (current)

Under `graph_types/edges/` + `EDGE_TYPE_DEFS`.

| Kind | Meaning | Typical endpoints |
|------|---------|-------------------|
| `serves` | Host serves this endpoint | `Host` → `Endpoint` |
| `discovered_by` | Endpoint observed by this import source | `Endpoint` → `Source` |
| `links_to` | Hyperlink / crawl discovery from one URL to another | `Endpoint` → `Endpoint` |

### Stable edge IDs

- **`EdgeTypeDef.stable_id(src_id, dst_id, properties)`** — typically hashes of endpoint pair plus a small discriminator.

## Merging

- **Nodes:** `merge_properties(existing, incoming)` on the type definition; used by `SqliteGraphStore.upsert_node`.
- **Edges:** `merge_properties` plus **`merge_sources`** to union ingest labels into `sources_json`.

## Normalization (before persist)

Pipeline applies **`normalizer_order`** from settings (default: `lowercase_host`, `collapse_trailing_slash`, `strip_utm`) to:

- **Host** keys and `hostname` property when present.
- **Endpoint** URLs and reconstructed `METHOD|url` keys.

This keeps duplicate observations from different tools from fragmenting the graph when they differ only by casing, trailing slashes, or marketing query parameters.

## Planned / roadmap kinds (from product spec)

The architecture supports additional kinds without schema migration beyond new rows:

- Nodes: `Parameter`, `Form`, `Asset`, `AuthArtifact`, `TechStack`, `Note`, `Tag`, …
- Edges: `redirects_to`, `submits_to`, `has_param`, `sets_cookie`, `requires_cookie`, …

Adding them: new `graph_types` module + registry entry + ingestor emitting the new shapes. See [EXTENDING.md](EXTENDING.md).

## Provenance

- Every **`RawNode` / `RawEdge`** carries a **`source`** string (often the human-readable ingest label).
- **`discovered_by`** edges connect endpoints to the **`Source`** node for that run.
- **Edge `sources_json`** accumulates which imports contributed to that relationship.
