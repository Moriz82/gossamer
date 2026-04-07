"""HTTP fetch layer with retry and redirect tracking."""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from urllib.parse import urljoin

import httpx


@dataclass
class FetchResult:
    url: str  # final URL after redirects
    status_code: int | None = None
    headers: dict[str, str] = field(default_factory=dict)
    body: str | None = None
    content_type: str = ""
    error: str | None = None
    redirect_chain: list[tuple[str, int]] = field(
        default_factory=list
    )  # (url, status) for each hop


_RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})

_RETRY_DELAYS = [0.5, 1.0, 2.0]


def fetch_url(
    client: httpx.Client,
    url: str,
    *,
    max_retries: int = 2,
    max_body_bytes: int = 2_000_000,
) -> FetchResult:
    """Fetch a URL with retry logic and manual redirect tracking."""
    result = FetchResult(url=url)
    current_url = url

    for _hop in range(10):  # max redirect hops
        resp = _fetch_with_retry(client, current_url, max_retries=max_retries)
        if resp is None:
            result.error = f"Failed after {max_retries + 1} attempts"
            return result

        if resp.is_redirect and resp.headers.get("location"):
            result.redirect_chain.append((current_url, resp.status_code))
            next_url = resp.headers["location"]
            # Handle relative redirects
            if not next_url.startswith("http"):
                next_url = urljoin(current_url, next_url)
            current_url = next_url
            continue

        # Final response
        result.url = current_url
        result.status_code = resp.status_code
        result.headers = dict(resp.headers)
        result.content_type = resp.headers.get("content-type", "")
        try:
            text = resp.text
            if len(text) <= max_body_bytes:
                result.body = text
        except Exception:
            pass
        return result

    result.error = "Too many redirects"
    return result


def _fetch_with_retry(
    client: httpx.Client, url: str, *, max_retries: int
) -> httpx.Response | None:
    for attempt in range(max_retries + 1):
        try:
            resp = client.get(url, follow_redirects=False)
            if resp.status_code not in _RETRY_STATUSES or attempt == max_retries:
                return resp
        except (httpx.TimeoutException, httpx.NetworkError):
            if attempt == max_retries:
                return None
        if attempt < max_retries:
            time.sleep(_RETRY_DELAYS[min(attempt, len(_RETRY_DELAYS) - 1)])
    return None
