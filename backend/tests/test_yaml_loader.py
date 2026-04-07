from __future__ import annotations

from pathlib import Path

from gossamer.graph_store.sqlite_store import SqliteGraphStore
from gossamer.queries.registry import _REGISTRY, get_query
from gossamer.queries.yaml_loader import _SAFE_SQL, load_yaml_queries


def test_safe_sql_accepts_select_only() -> None:
    assert _SAFE_SQL.match("SELECT id FROM nodes WHERE kind = 'x'")
    assert _SAFE_SQL.match("  select * from nodes")
    assert not _SAFE_SQL.match("DELETE FROM nodes")
    assert not _SAFE_SQL.match("INSERT INTO nodes VALUES (1)")


def test_load_queries_missing_dir() -> None:
    assert load_yaml_queries(Path("/__not_a_real_dir__/x")) == 0


def test_yaml_rejects_non_select(tmp_path) -> None:
    (tmp_path / "bad.yaml").write_text(
        "name: evil\ndescription: x\nsql: DELETE FROM nodes\n",
        encoding="utf-8",
    )
    before = set(_REGISTRY.keys())
    n = load_yaml_queries(tmp_path)
    assert n == 0
    after = set(_REGISTRY.keys())
    assert after == before


def test_yaml_rejects_semicolon(tmp_path) -> None:
    (tmp_path / "semi.yaml").write_text(
        "name: semi\ndescription: x\nsql: SELECT id FROM nodes; SELECT id FROM nodes\n",
        encoding="utf-8",
    )
    assert load_yaml_queries(tmp_path) == 0
    assert get_query("semi") is None


def test_yaml_loads_valid_custom_query(tmp_path) -> None:
    (tmp_path / "ok.yaml").write_text(
        "name: yaml_loader_smoke_query\ndescription: smoke\nsql: SELECT 1 AS one\n",
        encoding="utf-8",
    )
    assert load_yaml_queries(tmp_path) == 1
    q = get_query("yaml_loader_smoke_query")
    assert q is not None
    store = SqliteGraphStore(tmp_path / "yaml_q.sqlite")
    rows = q.run(store)
    assert rows == [{"one": 1}]
