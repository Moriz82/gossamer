# Gossamer documentation

Well-scoped reference material for humans and AI assistants working on the **Gossamer** standalone project (this repository root).

## Start here

1. **[ARCHITECTURE.md](ARCHITECTURE.md)** — How data moves through the system; folder map; design constraints.
2. **[GRAPH_MODEL.md](GRAPH_MODEL.md)** — What nodes and edges mean; stable IDs; merging; provenance.
3. **[API.md](API.md)** — REST endpoints, environment variables, ingestion workflows.
4. **[EXTENDING.md](EXTENDING.md)** — Copy-paste patterns for new ingestors, node/edge types, normalizers, queries.

## Repo pointers

- Root overview for operators: [../README.md](../README.md)
- Agent-oriented checklist: [../AGENTS.md](../AGENTS.md)
- Synthetic fixtures only: [../examples/](../examples/)

## Conventions

- **Ingestor name** (`name` attribute) doubles as an API `ingestor_hint` where disambiguation is needed.
- **`plugins.py` import order** is part of the behavior for `can_handle()` overlaps (especially `.json`).
- **`Source` nodes** record which import produced observations; edge `sources_json` aggregates ingest labels over time.

When documentation and code disagree, **trust the code** and update the markdown in the same change.
