"""Tests for sitemap/robots.txt discovery."""
from __future__ import annotations

from unittest.mock import MagicMock

import httpx

from gossamer.ingestors.discovery import (
    DiscoveryResult,
    discover_from_robots,
    discover_from_sitemap,
)


def _mock_response(status: int = 200, text: str = "") -> MagicMock:
    resp = MagicMock()
    resp.status_code = status
    resp.text = text
    return resp


# ---------- robots.txt tests ----------


def test_robots_parses_sitemap_and_disallow() -> None:
    body = (
        "User-agent: *\n"
        "Disallow: /admin/\n"
        "Disallow: /tmp/\n"
        "Sitemap: https://example.com/sitemap.xml\n"
        "Sitemap: https://example.com/sitemap2.xml\n"
    )
    client = MagicMock(spec=httpx.Client)
    client.get.return_value = _mock_response(200, body)

    result = discover_from_robots(client, "https://example.com")

    assert result.sitemap_urls == [
        "https://example.com/sitemap.xml",
        "https://example.com/sitemap2.xml",
    ]
    assert result.disallowed_paths == ["/admin/", "/tmp/"]
    client.get.assert_called_once_with(
        "https://example.com/robots.txt", follow_redirects=True
    )


def test_robots_404_returns_empty_result() -> None:
    client = MagicMock(spec=httpx.Client)
    client.get.return_value = _mock_response(404)

    result = discover_from_robots(client, "https://example.com")

    assert result.sitemap_urls == []
    assert result.disallowed_paths == []


def test_robots_network_error_returns_empty_result() -> None:
    client = MagicMock(spec=httpx.Client)
    client.get.side_effect = httpx.NetworkError("connection failed")

    result = discover_from_robots(client, "https://example.com")

    assert isinstance(result, DiscoveryResult)
    assert result.sitemap_urls == []


def test_robots_timeout_returns_empty_result() -> None:
    client = MagicMock(spec=httpx.Client)
    client.get.side_effect = httpx.TimeoutException("timed out")

    result = discover_from_robots(client, "https://example.com")

    assert result.sitemap_urls == []
    assert result.disallowed_paths == []


def test_robots_ignores_blank_paths_and_urls() -> None:
    body = "Disallow:\nSitemap:\nDisallow: /secret\n"
    client = MagicMock(spec=httpx.Client)
    client.get.return_value = _mock_response(200, body)

    result = discover_from_robots(client, "https://example.com")

    assert result.disallowed_paths == ["/secret"]
    assert result.sitemap_urls == []


def test_robots_case_insensitive_directives() -> None:
    body = "SITEMAP: https://example.com/sm.xml\nDISALLOW: /nope\n"
    client = MagicMock(spec=httpx.Client)
    client.get.return_value = _mock_response(200, body)

    result = discover_from_robots(client, "https://example.com")

    assert result.sitemap_urls == ["https://example.com/sm.xml"]
    assert result.disallowed_paths == ["/nope"]


def test_robots_strips_trailing_slash_from_base_url() -> None:
    client = MagicMock(spec=httpx.Client)
    client.get.return_value = _mock_response(404)

    discover_from_robots(client, "https://example.com/")

    client.get.assert_called_once_with(
        "https://example.com/robots.txt", follow_redirects=True
    )


# ---------- sitemap.xml tests ----------

SITEMAP_URLSET = """\
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/page1</loc></url>
  <url><loc>https://example.com/page2</loc></url>
  <url><loc>https://example.com/page3</loc></url>
</urlset>
"""

SITEMAP_INDEX = """\
<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/sitemap-posts.xml</loc></sitemap>
  <sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap>
</sitemapindex>
"""

SITEMAP_NO_NS = """\
<?xml version="1.0"?>
<urlset>
  <url><loc>https://example.com/no-ns</loc></url>
</urlset>
"""


def test_sitemap_parses_urlset() -> None:
    client = MagicMock(spec=httpx.Client)
    client.get.return_value = _mock_response(200, SITEMAP_URLSET)

    urls = discover_from_sitemap(client, "https://example.com/sitemap.xml")

    assert urls == [
        "https://example.com/page1",
        "https://example.com/page2",
        "https://example.com/page3",
    ]


def test_sitemap_index_recurses_into_sub_sitemaps() -> None:
    sub_sitemap = """\
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/post/1</loc></url>
</urlset>
"""
    client = MagicMock(spec=httpx.Client)
    client.get.side_effect = [
        _mock_response(200, SITEMAP_INDEX),
        _mock_response(200, sub_sitemap),
        _mock_response(200, sub_sitemap),
    ]

    urls = discover_from_sitemap(client, "https://example.com/sitemap.xml")

    assert urls == [
        "https://example.com/post/1",
        "https://example.com/post/1",
    ]
    assert client.get.call_count == 3


def test_sitemap_404_returns_empty() -> None:
    client = MagicMock(spec=httpx.Client)
    client.get.return_value = _mock_response(404)

    urls = discover_from_sitemap(client, "https://example.com/sitemap.xml")

    assert urls == []


def test_sitemap_malformed_xml_returns_empty() -> None:
    client = MagicMock(spec=httpx.Client)
    client.get.return_value = _mock_response(200, "<not valid xml!!!")

    urls = discover_from_sitemap(client, "https://example.com/sitemap.xml")

    assert urls == []


def test_sitemap_network_error_returns_empty() -> None:
    client = MagicMock(spec=httpx.Client)
    client.get.side_effect = httpx.NetworkError("refused")

    urls = discover_from_sitemap(client, "https://example.com/sitemap.xml")

    assert urls == []


def test_sitemap_timeout_returns_empty() -> None:
    client = MagicMock(spec=httpx.Client)
    client.get.side_effect = httpx.TimeoutException("timed out")

    urls = discover_from_sitemap(client, "https://example.com/sitemap.xml")

    assert urls == []


def test_sitemap_max_urls_limit() -> None:
    client = MagicMock(spec=httpx.Client)
    client.get.return_value = _mock_response(200, SITEMAP_URLSET)

    urls = discover_from_sitemap(
        client, "https://example.com/sitemap.xml", max_urls=2
    )

    assert len(urls) == 2
    assert urls == [
        "https://example.com/page1",
        "https://example.com/page2",
    ]


def test_sitemap_without_namespace() -> None:
    client = MagicMock(spec=httpx.Client)
    client.get.return_value = _mock_response(200, SITEMAP_NO_NS)

    urls = discover_from_sitemap(client, "https://example.com/sitemap.xml")

    assert urls == ["https://example.com/no-ns"]


def test_sitemap_whitespace_in_loc_is_stripped() -> None:
    xml = """\
<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>  https://example.com/spaced  </loc></url>
</urlset>
"""
    client = MagicMock(spec=httpx.Client)
    client.get.return_value = _mock_response(200, xml)

    urls = discover_from_sitemap(client, "https://example.com/sitemap.xml")

    assert urls == ["https://example.com/spaced"]


def test_sitemap_index_respects_max_urls_across_sub_sitemaps() -> None:
    sub1 = """\
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/a</loc></url>
  <url><loc>https://example.com/b</loc></url>
  <url><loc>https://example.com/c</loc></url>
</urlset>
"""
    sub2 = """\
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/d</loc></url>
  <url><loc>https://example.com/e</loc></url>
</urlset>
"""
    client = MagicMock(spec=httpx.Client)
    client.get.side_effect = [
        _mock_response(200, SITEMAP_INDEX),
        _mock_response(200, sub1),
        _mock_response(200, sub2),
    ]

    urls = discover_from_sitemap(
        client, "https://example.com/sitemap.xml", max_urls=4
    )

    # First sub-sitemap yields 3, second should be capped at 1
    assert len(urls) == 4
    assert urls == [
        "https://example.com/a",
        "https://example.com/b",
        "https://example.com/c",
        "https://example.com/d",
    ]
