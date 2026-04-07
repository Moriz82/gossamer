from __future__ import annotations

import json

from gossamer.graph_store.sqlite_store import SqliteGraphStore
from gossamer.pipeline import ingest_and_store
from gossamer.config import Settings
from gossamer.queries.builtins import AllEndpointsQuery, HighStatusCodesQuery, PostEndpointsQuery
from pathlib import Path


def _sample_db(tmp_path: Path, url: str, method: str, status: int) -> SqliteGraphStore:
    p = tmp_path / "line.jsonl"
    p.write_text(
        json.dumps({"url": url, "method": method, "status_code": status}) + "\n",
        encoding="utf-8",
    )
    db = tmp_path / "q.sqlite"
    store = SqliteGraphStore(db)
    ingest_and_store(store, p, "s", "httpx_json", Settings(database_path=db))
    return store


def test_all_endpoints_query(tmp_path: Path) -> None:
    store = _sample_db(tmp_path, "https://qunit.test/a", "GET", 200)
    q = AllEndpointsQuery()
    rows = q.run(store._conn)
    assert any("qunit.test" in str(r.get("key", "")) for r in rows)


def test_post_endpoints_query(tmp_path: Path) -> None:
    store = _sample_db(tmp_path, "https://postq.test/x", "POST", 200)
    rows = PostEndpointsQuery().run(store._conn)
    assert any("POST" in str(r.get("key", "")) for r in rows)


def test_interesting_status_codes_query(tmp_path: Path) -> None:
    store = _sample_db(tmp_path, "https://stat.test/y", "GET", 401)
    rows = HighStatusCodesQuery().run(store._conn)
    assert len(rows) >= 1
    props = rows[0]["properties"]
    assert props.get("status_code") == 401
