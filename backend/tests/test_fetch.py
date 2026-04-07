"""Tests for the fetch layer (retry + redirect tracking)."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import httpx

from gossamer.ingestors.fetch import fetch_url


def _mock_response(
    status: int,
    headers: dict[str, str] | None = None,
    text: str = "",
    is_redirect: bool = False,
) -> MagicMock:
    r = MagicMock(spec=httpx.Response)
    r.status_code = status
    r.headers = headers or {"content-type": "text/html"}
    r.text = text
    r.is_redirect = is_redirect
    return r


class TestFetchUrlSuccess:
    """Successful fetch returns correct FetchResult."""

    @patch("gossamer.ingestors.fetch.time.sleep")
    def test_basic_200(self, mock_sleep: MagicMock) -> None:
        client = MagicMock(spec=httpx.Client)
        client.get.return_value = _mock_response(
            200,
            headers={"content-type": "text/html; charset=utf-8"},
            text="<html>hello</html>",
        )

        result = fetch_url(client, "https://example.com/page")

        assert result.url == "https://example.com/page"
        assert result.status_code == 200
        assert result.body == "<html>hello</html>"
        assert "text/html" in result.content_type
        assert result.error is None
        assert result.redirect_chain == []
        mock_sleep.assert_not_called()


class TestFetchUrlRetry:
    """Retry on transient errors."""

    @patch("gossamer.ingestors.fetch.time.sleep")
    def test_retry_on_503_then_success(self, mock_sleep: MagicMock) -> None:
        client = MagicMock(spec=httpx.Client)
        client.get.side_effect = [
            _mock_response(503, text=""),
            _mock_response(200, headers={"content-type": "text/html"}, text="ok"),
        ]

        result = fetch_url(client, "https://example.com/", max_retries=2)

        assert result.status_code == 200
        assert result.body == "ok"
        assert result.error is None
        assert mock_sleep.call_count == 1

    @patch("gossamer.ingestors.fetch.time.sleep")
    def test_retry_exhaustion(self, mock_sleep: MagicMock) -> None:
        client = MagicMock(spec=httpx.Client)
        # All attempts return 503
        client.get.return_value = _mock_response(503, text="")

        result = fetch_url(client, "https://example.com/fail", max_retries=1)

        # After exhausting retries, it returns the last response (503)
        assert result.status_code == 503
        assert result.error is None  # response was returned, just with 503 status
        assert mock_sleep.call_count == 1

    @patch("gossamer.ingestors.fetch.time.sleep")
    def test_network_error_exhaustion(self, mock_sleep: MagicMock) -> None:
        client = MagicMock(spec=httpx.Client)
        client.get.side_effect = httpx.NetworkError("connection refused")

        result = fetch_url(client, "https://example.com/down", max_retries=1)

        assert result.status_code is None
        assert result.error is not None
        assert "Failed after" in result.error


class TestFetchUrlRedirects:
    """Redirect chain tracking."""

    @patch("gossamer.ingestors.fetch.time.sleep")
    def test_single_redirect(self, mock_sleep: MagicMock) -> None:
        client = MagicMock(spec=httpx.Client)
        client.get.side_effect = [
            _mock_response(
                301,
                headers={"location": "https://example.com/new", "content-type": ""},
                is_redirect=True,
            ),
            _mock_response(
                200,
                headers={"content-type": "text/html"},
                text="<html>final</html>",
            ),
        ]

        result = fetch_url(client, "https://example.com/old")

        assert result.url == "https://example.com/new"
        assert result.status_code == 200
        assert result.body == "<html>final</html>"
        assert len(result.redirect_chain) == 1
        assert result.redirect_chain[0] == ("https://example.com/old", 301)

    @patch("gossamer.ingestors.fetch.time.sleep")
    def test_multiple_redirects(self, mock_sleep: MagicMock) -> None:
        client = MagicMock(spec=httpx.Client)
        client.get.side_effect = [
            _mock_response(
                301,
                headers={"location": "https://example.com/b", "content-type": ""},
                is_redirect=True,
            ),
            _mock_response(
                302,
                headers={"location": "https://example.com/c", "content-type": ""},
                is_redirect=True,
            ),
            _mock_response(
                200,
                headers={"content-type": "text/html"},
                text="done",
            ),
        ]

        result = fetch_url(client, "https://example.com/a")

        assert result.url == "https://example.com/c"
        assert result.status_code == 200
        assert len(result.redirect_chain) == 2
        assert result.redirect_chain[0] == ("https://example.com/a", 301)
        assert result.redirect_chain[1] == ("https://example.com/b", 302)

    @patch("gossamer.ingestors.fetch.time.sleep")
    def test_relative_redirect(self, mock_sleep: MagicMock) -> None:
        client = MagicMock(spec=httpx.Client)
        client.get.side_effect = [
            _mock_response(
                302,
                headers={"location": "/relative-path", "content-type": ""},
                is_redirect=True,
            ),
            _mock_response(
                200,
                headers={"content-type": "text/html"},
                text="ok",
            ),
        ]

        result = fetch_url(client, "https://example.com/start")

        assert result.url == "https://example.com/relative-path"
        assert result.status_code == 200
        assert len(result.redirect_chain) == 1

    @patch("gossamer.ingestors.fetch.time.sleep")
    def test_too_many_redirects(self, mock_sleep: MagicMock) -> None:
        client = MagicMock(spec=httpx.Client)
        # 10+ redirects should trigger "Too many redirects"
        client.get.return_value = _mock_response(
            301,
            headers={"location": "https://example.com/loop", "content-type": ""},
            is_redirect=True,
        )

        result = fetch_url(client, "https://example.com/loop")

        assert result.error == "Too many redirects"


class TestFetchUrlBodyLimit:
    """Max body size enforcement."""

    @patch("gossamer.ingestors.fetch.time.sleep")
    def test_body_over_limit_not_stored(self, mock_sleep: MagicMock) -> None:
        large_body = "x" * 100
        client = MagicMock(spec=httpx.Client)
        client.get.return_value = _mock_response(
            200,
            headers={"content-type": "text/html"},
            text=large_body,
        )

        result = fetch_url(client, "https://example.com/big", max_body_bytes=50)

        assert result.status_code == 200
        assert result.body is None  # body exceeds limit

    @patch("gossamer.ingestors.fetch.time.sleep")
    def test_body_under_limit_stored(self, mock_sleep: MagicMock) -> None:
        small_body = "x" * 10
        client = MagicMock(spec=httpx.Client)
        client.get.return_value = _mock_response(
            200,
            headers={"content-type": "text/html"},
            text=small_body,
        )

        result = fetch_url(client, "https://example.com/small", max_body_bytes=50)

        assert result.status_code == 200
        assert result.body == small_body
