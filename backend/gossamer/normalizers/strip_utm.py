from __future__ import annotations

from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

_STRIP_KEYS = frozenset(
    [
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
        "gclid",
        "fbclid",
        "mc_eid",
    ]
)


class StripUtm:
    name = "strip_utm"

    def normalize_url_string(self, url: str, context: dict[str, Any]) -> str:
        try:
            p = urlparse(url)
            if not p.query:
                return url
            q = parse_qs(p.query, keep_blank_values=True)
            filtered = {
                k: v for k, v in q.items() if k not in _STRIP_KEYS and not k.startswith("utm_")
            }
            new_query = urlencode(filtered, doseq=True)
            return urlunparse((p.scheme, p.netloc, p.path, p.params, new_query, p.fragment))
        except Exception:
            return url

    def normalize_host(self, host: str, context: dict[str, Any]) -> str:
        return host
