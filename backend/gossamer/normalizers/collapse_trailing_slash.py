from __future__ import annotations

from typing import Any
from urllib.parse import urlparse, urlunparse


class CollapseTrailingSlash:
    name = "collapse_trailing_slash"

    def normalize_url_string(self, url: str, context: dict[str, Any]) -> str:
        try:
            p = urlparse(url)
            path = p.path or "/"
            if path != "/" and path.endswith("/"):
                path = path.rstrip("/")
            return urlunparse((p.scheme, p.netloc, path or "/", p.params, p.query, p.fragment))
        except Exception:
            return url

    def normalize_host(self, host: str, context: dict[str, Any]) -> str:
        return host
