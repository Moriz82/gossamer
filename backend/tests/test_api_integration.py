from __future__ import annotations

import json
import zipfile
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi.testclient import TestClient


def test_ingestors_and_normalizers_catalog(isolated_client: "TestClient") -> None:
    ing = isolated_client.get("/api/ingestors").json()
    assert isinstance(ing, list)
    names = {x["name"] for x in ing}
    assert "httpx_json" in names
    assert "crawl_seed" in names
    assert "nuclei_json" in names
    by_name = {x["name"]: x for x in ing}
    assert by_name["nuclei_json"].get("role") == "scanner"


def test_findings_empty(isolated_client: "TestClient") -> None:
    r = isolated_client.get("/api/findings")
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 0
    assert body["findings"] == []


def test_templates_list_and_download(isolated_client: "TestClient") -> None:
    r = isolated_client.get("/api/templates")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) >= 1

    bad = isolated_client.get("/api/templates/download")
    assert bad.status_code == 400

    r_all = isolated_client.get("/api/templates/download?all=1")
    assert r_all.status_code == 200
    assert "zip" in (r_all.headers.get("content-type") or "").lower()

    tid = data[0]["id"]
    r_one = isolated_client.get(f"/api/templates/download?ids={tid}")
    assert r_one.status_code == 200
    norm = isolated_client.get("/api/normalizers").json()
    assert any(n["name"] == "strip_utm" for n in norm)


def test_health(isolated_client: "TestClient") -> None:
    r = isolated_client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_graph_type_registry(isolated_client: "TestClient") -> None:
    r = isolated_client.get("/api/graph-type-registry")
    assert r.status_code == 200
    reg = r.json()
    assert "Host" in reg["nodes"]
    assert "serves" in reg["edges"]


def test_graph_empty_then_ingest_path(isolated_client: "TestClient", tmp_path: Path) -> None:
    g = isolated_client.get("/api/graph")
    assert g.json()["nodes"] == []

    sample = tmp_path / "out.jsonl"
    sample.write_text(
        json.dumps({"url": "https://api-int.test/hi", "method": "GET", "status_code": 200}) + "\n",
        encoding="utf-8",
    )
    r = isolated_client.post(
        "/api/ingest/path",
        json={"path": str(sample), "source_label": "t1", "ingestor_hint": "httpx_json"},
    )
    assert r.status_code == 200
    assert r.json()["ok"] is True

    snap = isolated_client.get("/api/graph").json()
    kinds = {n["kind"] for n in snap["nodes"]}
    assert "Endpoint" in kinds
    assert "Host" in kinds


def test_ingest_path_missing_file(isolated_client: "TestClient", tmp_path: Path) -> None:
    r = isolated_client.post(
        "/api/ingest/path",
        json={"path": str(tmp_path / "nope.jsonl"), "source_label": "x"},
    )
    assert r.status_code == 404


def test_ingest_multipart_upload(isolated_client: "TestClient", tmp_path: Path) -> None:
    sample = tmp_path / "up.jsonl"
    sample.write_text(
        json.dumps({"url": "https://upload.test/", "method": "POST"}) + "\n", encoding="utf-8"
    )
    files = {"file": ("sample.jsonl", sample.read_bytes(), "application/octet-stream")}
    r = isolated_client.post("/api/ingest?source_label=up", files=files)
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_graph_clear(isolated_client: "TestClient", tmp_path: Path) -> None:
    sample = tmp_path / "c.jsonl"
    sample.write_text(
        json.dumps({"url": "https://clear.test/", "method": "GET"}) + "\n", encoding="utf-8"
    )
    isolated_client.post("/api/ingest/path", json={"path": str(sample), "ingestor_hint": "httpx_json"})
    assert len(isolated_client.get("/api/graph").json()["nodes"]) > 0
    d = isolated_client.delete("/api/graph")
    assert d.status_code == 200
    assert isolated_client.get("/api/graph").json()["nodes"] == []


def test_queries_list_includes_builtins_and_yaml_example(isolated_client: "TestClient") -> None:
    r = isolated_client.get("/api/queries")
    assert r.status_code == 200
    names = {q["name"] for q in r.json()}
    assert "all_endpoints" in names
    assert "endpoints_admin_in_path" in names


def test_query_run_all_endpoints(isolated_client: "TestClient", tmp_path: Path) -> None:
    sample = tmp_path / "q.jsonl"
    sample.write_text(
        json.dumps({"url": "https://query.test/x", "method": "GET"}) + "\n", encoding="utf-8"
    )
    isolated_client.post("/api/ingest/path", json={"path": str(sample), "ingestor_hint": "httpx_json"})
    r = isolated_client.post("/api/queries/all_endpoints/run")
    assert r.status_code == 200
    rows = r.json()
    assert isinstance(rows, list)
    assert any("query.test" in str(row.get("key", "")) for row in rows)


def test_query_unknown(isolated_client: "TestClient") -> None:
    r = isolated_client.post("/api/queries/does_not_exist/run")
    assert r.status_code == 404


def test_export_bundle(isolated_client: "TestClient", tmp_path: Path) -> None:
    sample = tmp_path / "e.jsonl"
    sample.write_text(
        json.dumps({"url": "https://export.test/", "method": "GET"}) + "\n", encoding="utf-8"
    )
    isolated_client.post("/api/ingest/path", json={"path": str(sample), "ingestor_hint": "httpx_json"})
    r = isolated_client.post("/api/export/bundle")
    assert r.status_code == 200
    zpath = Path(r.json()["path"])
    assert zpath.is_file()
    with zipfile.ZipFile(zpath) as zf:
        names = set(zf.namelist())
        assert any(n.endswith(".sqlite") or n.endswith("graph.sqlite") for n in names)
        assert "manifest.json" in names


def test_import_export_roundtrip(isolated_client: "TestClient", tmp_path: Path) -> None:
    sample = tmp_path / "round.jsonl"
    sample.write_text(
        json.dumps({"url": "https://roundtrip.test/item", "method": "GET"}) + "\n",
        encoding="utf-8",
    )
    isolated_client.post("/api/ingest/path", json={"path": str(sample), "ingestor_hint": "httpx_json"})
    before = len(isolated_client.get("/api/graph").json()["nodes"])
    assert before > 0

    exp = isolated_client.post("/api/export/bundle")
    zpath = exp.json()["path"]

    isolated_client.delete("/api/graph")
    assert isolated_client.get("/api/graph").json()["nodes"] == []

    imp = isolated_client.post("/api/import/bundle", json={"zip_path": zpath, "replace": True})
    assert imp.status_code == 200
    after = isolated_client.get("/api/graph").json()["nodes"]
    assert len(after) == before


def _ingest_sample(client: "TestClient", tmp_path: Path, url: str = "https://stats.test/page") -> None:
    """Helper: ingest a single httpx_json record so the graph has Host + Endpoint nodes."""
    sample = tmp_path / "sample.jsonl"
    sample.write_text(
        json.dumps({"url": url, "method": "GET", "status_code": 200}) + "\n",
        encoding="utf-8",
    )
    client.post("/api/ingest/path", json={"path": str(sample), "ingestor_hint": "httpx_json"})


def test_graph_stats_empty(isolated_client: "TestClient") -> None:
    r = isolated_client.get("/api/graph/stats")
    assert r.status_code == 200
    body = r.json()
    assert body["total_nodes"] == 0
    assert body["total_edges"] == 0
    assert body["node_counts"] == {}
    assert body["edge_counts"] == {}


def test_graph_stats_after_ingest(isolated_client: "TestClient", tmp_path: Path) -> None:
    _ingest_sample(isolated_client, tmp_path)
    r = isolated_client.get("/api/graph/stats")
    assert r.status_code == 200
    body = r.json()
    assert body["total_nodes"] > 0
    assert "Host" in body["node_counts"]
    assert "Endpoint" in body["node_counts"]
    assert body["total_edges"] > 0


def test_graph_filter_by_kinds(isolated_client: "TestClient", tmp_path: Path) -> None:
    _ingest_sample(isolated_client, tmp_path)
    r = isolated_client.get("/api/graph?kinds=Host")
    assert r.status_code == 200
    snap = r.json()
    assert len(snap["nodes"]) > 0
    assert all(n["kind"] == "Host" for n in snap["nodes"])
    # Edges should be empty since endpoints are excluded
    # (edges only included when both endpoints are in the set)


def test_graph_filter_exclude_kinds(isolated_client: "TestClient", tmp_path: Path) -> None:
    _ingest_sample(isolated_client, tmp_path)
    r = isolated_client.get("/api/graph?exclude_kinds=Endpoint,Source")
    assert r.status_code == 200
    snap = r.json()
    for n in snap["nodes"]:
        assert n["kind"] not in ("Endpoint", "Source")


def test_graph_no_params_backward_compat(isolated_client: "TestClient", tmp_path: Path) -> None:
    _ingest_sample(isolated_client, tmp_path)
    r = isolated_client.get("/api/graph")
    assert r.status_code == 200
    snap = r.json()
    kinds = {n["kind"] for n in snap["nodes"]}
    # Full snapshot should contain at least Host and Endpoint
    assert "Host" in kinds
    assert "Endpoint" in kinds
    # Enrichment should still be applied
    for n in snap["nodes"]:
        assert "color" in n
        assert "label" in n


def test_graph_snapshot_enriches_colors(isolated_client: "TestClient", tmp_path: Path) -> None:
    sample = tmp_path / "col.jsonl"
    sample.write_text(
        json.dumps({"url": "https://color.test/", "method": "GET"}) + "\n", encoding="utf-8"
    )
    isolated_client.post("/api/ingest/path", json={"path": str(sample), "ingestor_hint": "httpx_json"})
    snap = isolated_client.get("/api/graph").json()
    for n in snap["nodes"]:
        if n["kind"] == "Host":
            assert "color" in n
            break
    else:
        raise AssertionError("expected Host node")
