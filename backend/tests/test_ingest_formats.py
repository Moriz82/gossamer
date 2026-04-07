from __future__ import annotations

import json
from pathlib import Path

import pytest

from gossamer.config import Settings
from gossamer.graph_store.sqlite_store import SqliteGraphStore
from gossamer.ingestors.registry import get_ingestor
from gossamer.pipeline import ingest_and_store, run_ingest


def test_httpx_json_jsonl(tmp_path: Path) -> None:
    p = tmp_path / "a.jsonl"
    p.write_text(
        json.dumps({"url": "https://httpxfmt.test/z", "method": "GET", "status_code": 200}) + "\n"
    )
    batch = run_ingest(p, "s", "httpx_json", Settings())
    kinds = {n.kind for n in batch.nodes}
    assert "Endpoint" in kinds


def test_ffuf_json(tmp_path: Path) -> None:
    p = tmp_path / "ff.json"
    p.write_text(
        json.dumps(
            {
                "input": {"url": "https://ffuf.test/FUZZ"},
                "results": [{"url": "https://ffuf.test/dir", "method": "GET"}],
            }
        ),
        encoding="utf-8",
    )
    batch = run_ingest(p, "ff", "ffuf_json", Settings())
    assert any("ffuf.test" in str(n.properties.get("hostname", "")) for n in batch.nodes)


def test_burp_xml(tmp_path: Path) -> None:
    p = tmp_path / "b.xml"
    p.write_text(
        """<?xml version="1.0"?>
    <items>
      <item>
        <url>https://burpfmt.test/api</url>
        <method>POST</method>
        <status>201</status>
      </item>
    </items>""",
        encoding="utf-8",
    )
    batch = run_ingest(p, "b", "burp_xml", Settings())
    eps = [n for n in batch.nodes if n.kind == "Endpoint"]
    assert any("burpfmt.test" in str(n.properties.get("url", "")) for n in eps)


def test_zap_json_site_alerts(tmp_path: Path) -> None:
    p = tmp_path / "z.json"
    p.write_text(
        json.dumps(
            {
                "site": [
                    {
                        "alerts": [
                            {
                                "instances": [
                                    {"uri": "https://zapfmt.test/page", "method": "GET"},
                                ]
                            }
                        ]
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    batch = run_ingest(p, "z", "zap_json", Settings())
    assert any(n.kind == "Endpoint" for n in batch.nodes)


def test_katana_jsonl(tmp_path: Path) -> None:
    p = tmp_path / "k.jsonl"
    line = json.dumps(
        {"request": {"endpoint": "https://katana.test/hi", "method": "GET"}},
    )
    p.write_text(line + "\n", encoding="utf-8")
    batch = run_ingest(p, "k", "katana_jsonl", Settings())
    assert any("katana.test" in str(n.properties.get("hostname", n.properties.get("url", ""))) for n in batch.nodes)


def test_ingestor_hint_overrides_extension(tmp_path: Path) -> None:
    p = tmp_path / "wrong.ext"
    p.write_text(
        json.dumps({"url": "https://hint.test/", "method": "GET"}) + "\n",
        encoding="utf-8",
    )
    ing = get_ingestor(p, hint="httpx_json")
    assert ing is not None
    assert ing.name == "httpx_json"


def test_run_ingest_unknown_file_raises() -> None:
    with pytest.raises(ValueError, match="No ingestor"):
        run_ingest(Path("/nonexistent/bogus.xyz"), "s", None, Settings())


def test_persist_skips_unknown_node_kind(tmp_path: Path) -> None:
    db = tmp_path / "u.sqlite"
    store = SqliteGraphStore(db)
    p = tmp_path / "x.jsonl"
    p.write_text(
        json.dumps({"url": "https://persist.test/", "method": "GET"}) + "\n",
        encoding="utf-8",
    )
    settings = Settings(database_path=db)
    stats = ingest_and_store(store, p, "lbl", "httpx_json", settings)
    assert stats["nodes"] >= 3
    snap = store.get_graph_snapshot()
    assert all(n["kind"] != "FakeKind" for n in snap["nodes"])
