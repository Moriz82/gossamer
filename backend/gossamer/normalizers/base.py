from __future__ import annotations

from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class NormalizerStep(Protocol):
    name: str

    def normalize_url_string(self, url: str, context: dict[str, Any]) -> str:
        """Return normalized URL string (best-effort)."""
        ...


@runtime_checkable
class HostNormalizerStep(Protocol):
    name: str

    def normalize_host(self, host: str, context: dict[str, Any]) -> str:
        ...
