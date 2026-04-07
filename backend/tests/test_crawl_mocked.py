from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

from gossamer.config import Settings
from gossamer.graph_store.sqlite_store import SqliteGraphStore
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
