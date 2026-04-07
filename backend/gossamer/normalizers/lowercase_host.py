from __future__ import annotations

from typing import Any
from urllib.parse import urlparse, urlunparse


class LowercaseHost:
    name = "lowercase_host"

    def normalize_url_string(self, url: str, context: dict[str, Any]) -> str:
        try:
            p = urlparse(url)
            host = (p.hostname or "").lower()
            if not host:
                return url
            netloc = host
            if p.port and p.port not in (80, 443) or (p.scheme == "https" and p.port not in (None, 443)):
                netloc = f"{host}:{p.port}" if p.port else host
            return urlunparse((p.scheme.lower(), netloc, p.path, p.params, p.query, p.fragment))
        except Exception:
            return url

    def normalize_host(self, host: str, context: dict[str, Any]) -> str:
        return host.strip().lower()
