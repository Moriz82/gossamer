from __future__ import annotations

import json
from pathlib import Path

from gossamer.config import Settings
from gossamer.graph_store.sqlite_store import SqliteGraphStore
from gossamer.pipeline import ingest_and_store, run_ingest
from gossamer.ingestors.plugins import *  # noqa: F401,F403


def test_run_httpx_ingest(tmp_path: Path) -> None:
    sample = tmp_path / "out.jsonl"
    sample.write_text(
        json.dumps(
            {
                "url": "https://example.org/api",
                "method": "GET",
                "status_code": 200,
            }
        )
        + "\n",
        encoding="utf-8",
    )
    settings = Settings(database_path=tmp_path / "g.db")
    batch = run_ingest(sample, "test", "httpx_json", settings)
    kinds = {n.kind for n in batch.nodes}
    assert "Host" in kinds
    assert "Endpoint" in kinds
    assert "Source" in kinds
    assert any(e.kind == "serves" for e in batch.edges)


def test_ingest_and_store(tmp_path: Path) -> None:
    sample = tmp_path / "out.jsonl"
    sample.write_text(
        json.dumps({"url": "https://foo.test/", "method": "GET", "status_code": 200}) + "\n",
        encoding="utf-8",
    )
    settings = Settings(database_path=tmp_path / "g.db")
    store = SqliteGraphStore(settings.database_path)
    stats = ingest_and_store(store, sample, "t", "httpx_json", settings)
    assert stats["nodes"] >= 3
    snap = store.get_graph_snapshot()
    assert len(snap["nodes"]) >= 3
