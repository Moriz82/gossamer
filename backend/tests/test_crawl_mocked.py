from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

from gossamer.config import Settings
from gossamer.graph_store.sqlite_store import SqliteGraphStore
from gossamer.models import RawObservationBatch
from gossamer.pipeline import ingest_and_store


@patch("gossamer.ingestors.crawl.httpx.Client")
def test_crawl_ingest_fetches_seed_and_internal_link(mock_client_cls, tmp_path: Path) -> None:
    seed = tmp_path / "seeds.urlseed"
    seed.write_text("https://crawl-mock.test/start\n", encoding="utf-8")

    html = '<html><body><a href="https://crawl-mock.test/second">go</a></body></html>'

    def make_resp(status: int, ctype: str, text: str) -> MagicMock:
        r = MagicMock()
        r.status_code = status
        r.headers = {"content-type": ctype}
        r.text = text
        r.is_redirect = False
        return r

    inst = MagicMock()
    inst.__enter__ = MagicMock(return_value=inst)
    inst.__exit__ = MagicMock(return_value=False)
    inst.get = MagicMock(
        side_effect=[
            make_resp(404, "text/plain", ""),       # robots.txt
            make_resp(404, "text/plain", ""),       # default sitemap.xml
            make_resp(200, "text/html", html),
            make_resp(200, "text/html", "<html></html>"),
        ]
    )
    mock_client_cls.return_value = inst

    db = tmp_path / "crawl.sqlite"
    store = SqliteGraphStore(db)
    settings = Settings(database_path=db, crawl_max_depth=2, crawl_max_pages=10, scope_hosts=[])
    stats = ingest_and_store(
        store, seed, "crawl1", "crawl_seed", settings, extra_options={"max_depth": 2, "max_pages": 10}
    )
    assert stats["nodes"] >= 4
    snap = store.get_graph_snapshot()
    urls = [n["properties"].get("url") for n in snap["nodes"] if n["kind"] == "Endpoint"]
    assert any(u and "crawl-mock.test" in str(u) for u in urls)
    store.close()


@patch("gossamer.ingestors.crawl.httpx.Client")
def test_crawl_audit_emits_header_finding(mock_client_cls, tmp_path: Path) -> None:
    seed = tmp_path / "seeds.urlseed"
    seed.write_text("https://audit-mock.test/start\n", encoding="utf-8")
    html = "<html><body></body></html>"

    def make_resp(status: int, ctype: str, text: str, hdrs: dict | None = None) -> MagicMock:
        r = MagicMock()
        r.status_code = status
        r.headers = hdrs or {"content-type": ctype}
        r.text = text
        r.is_redirect = False
        return r

    inst = MagicMock()
    inst.__enter__ = MagicMock(return_value=inst)
    inst.__exit__ = MagicMock(return_value=False)
    inst.get = MagicMock(
        side_effect=[
            make_resp(404, "text/plain", ""),
            make_resp(404, "text/plain", ""),
            make_resp(200, "text/html", html, {}),
        ]
    )
    mock_client_cls.return_value = inst

    db = tmp_path / "crawl-audit.sqlite"
    store = SqliteGraphStore(db)
    settings = Settings(database_path=db, crawl_max_depth=1, crawl_max_pages=2, scope_hosts=[])
    ingest_and_store(
        store,
        seed,
        "crawl-a",
        "crawl_seed",
        settings,
        extra_options={"max_depth": 1, "max_pages": 2, "audit": True},
    )
    kinds = {n["kind"] for n in store.get_graph_snapshot()["nodes"]}
    assert "Finding" in kinds
    store.close()


# ---------------------------------------------------------------------------
# Unit tests for the new crawl-audit checks
# ---------------------------------------------------------------------------

def _run_audit(
    url: str,
    status: int | None,
    headers: dict[str, str],
    content_type: str = "text/html",
    body: str | None = None,
    redirect_location: str | None = None,
) -> RawObservationBatch:
    """Helper: invoke _emit_crawl_audit_findings and return the batch."""
    from gossamer.ingestors.crawl import _emit_crawl_audit_findings

    batch = RawObservationBatch()
    _emit_crawl_audit_findings(
        batch,
        url=url,
        method="GET",
        status=status,
        headers=headers,
        content_type=content_type,
        source_key="test:src",
        source_label="test",
        body=body,
        redirect_location=redirect_location,
    )
    return batch


def _finding_names(batch: RawObservationBatch) -> list[str]:
    return [n.properties.get("name", "") for n in batch.nodes if n.kind == "Finding"]


def _finding_template_ids(batch: RawObservationBatch) -> list[str]:
    return [n.properties.get("template_id", "") for n in batch.nodes if n.kind == "Finding"]


def test_directory_listing_detection() -> None:
    body = "<html><title>Index of /uploads</title><body></body></html>"
    batch = _run_audit(
        "https://example.com/uploads/",
        status=200,
        headers={"content-type": "text/html"},
        body=body,
    )
    assert "directory_listing" in _finding_template_ids(batch)


def test_directory_listing_h1_variant() -> None:
    body = "<html><body><H1>Index of /files</H1></body></html>"
    batch = _run_audit(
        "https://example.com/files/",
        status=200,
        headers={"content-type": "text/html"},
        body=body,
    )
    assert "directory_listing" in _finding_template_ids(batch)


def test_insecure_cookie() -> None:
    batch = _run_audit(
        "https://example.com/",
        status=200,
        headers={"content-type": "text/html", "Set-Cookie": "sess=abc; Path=/"},
    )
    tids = _finding_template_ids(batch)
    assert "insecure_cookie" in tids
    names = _finding_names(batch)
    cookie_finding = [n for n in names if "Cookie missing" in n]
    assert len(cookie_finding) == 1
    assert "Secure" in cookie_finding[0]
    assert "HttpOnly" in cookie_finding[0]
    assert "SameSite" in cookie_finding[0]


def test_secure_cookie_no_finding() -> None:
    batch = _run_audit(
        "https://example.com/",
        status=200,
        headers={
            "content-type": "text/html",
            "Set-Cookie": "sess=abc; Secure; HttpOnly; SameSite=Strict",
        },
    )
    assert "insecure_cookie" not in _finding_template_ids(batch)


def test_cors_wildcard() -> None:
    batch = _run_audit(
        "https://example.com/api",
        status=200,
        headers={"content-type": "text/html", "Access-Control-Allow-Origin": "*"},
    )
    assert "cors_wildcard" in _finding_template_ids(batch)


def test_cors_specific_origin_no_finding() -> None:
    batch = _run_audit(
        "https://example.com/api",
        status=200,
        headers={
            "content-type": "text/html",
            "Access-Control-Allow-Origin": "https://trusted.com",
        },
    )
    assert "cors_wildcard" not in _finding_template_ids(batch)


def test_server_version_disclosure() -> None:
    batch = _run_audit(
        "https://example.com/",
        status=200,
        headers={"content-type": "text/html", "Server": "Apache/2.4.51"},
    )
    tids = _finding_template_ids(batch)
    assert "server_version_disclosure" in tids
    names = _finding_names(batch)
    assert any("Apache/2.4.51" in n for n in names)


def test_server_no_version_no_finding() -> None:
    batch = _run_audit(
        "https://example.com/",
        status=200,
        headers={"content-type": "text/html", "Server": "nginx"},
    )
    assert "server_version_disclosure" not in _finding_template_ids(batch)


def test_sensitive_path_git() -> None:
    batch = _run_audit(
        "https://example.com/.git/config",
        status=200,
        headers={"content-type": "text/plain"},
        content_type="text/plain",
    )
    tids = _finding_template_ids(batch)
    assert "sensitive_path" in tids


def test_sensitive_path_404_no_finding() -> None:
    batch = _run_audit(
        "https://example.com/.git/config",
        status=404,
        headers={"content-type": "text/plain"},
        content_type="text/plain",
    )
    assert "sensitive_path" not in _finding_template_ids(batch)


def test_open_redirect() -> None:
    batch = _run_audit(
        "https://example.com/redir",
        status=302,
        headers={"content-type": "text/html", "Location": "https://evil.com/phish"},
        redirect_location="https://evil.com/phish",
    )
    tids = _finding_template_ids(batch)
    assert "open_redirect" in tids
    names = _finding_names(batch)
    assert any("evil.com" in n for n in names)


def test_redirect_same_domain_no_finding() -> None:
    batch = _run_audit(
        "https://example.com/old",
        status=301,
        headers={"content-type": "text/html", "Location": "https://example.com/new"},
        redirect_location="https://example.com/new",
    )
    assert "open_redirect" not in _finding_template_ids(batch)


def test_redirect_subdomain_no_finding() -> None:
    batch = _run_audit(
        "https://example.com/old",
        status=301,
        headers={"content-type": "text/html", "Location": "https://www.example.com/new"},
        redirect_location="https://www.example.com/new",
    )
    assert "open_redirect" not in _finding_template_ids(batch)


def test_normal_response_no_false_positives() -> None:
    batch = _run_audit(
        "https://example.com/page",
        status=200,
        headers={
            "content-type": "text/html",
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "Content-Security-Policy": "default-src 'self'",
        },
        body="<html><body>Hello world</body></html>",
    )
    # No findings should be emitted for a well-configured page
    assert len(_finding_template_ids(batch)) == 0
