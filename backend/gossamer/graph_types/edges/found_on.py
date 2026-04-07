"""Edge type: found_on — Finding observed on a specific endpoint."""
from __future__ import annotations

import hashlib
from typing import Any


class FoundOnEdge:
    kind = "found_on"

    def stable_id(self, src_id: str, dst_id: str, properties: dict[str, Any]) -> str:
        sig = properties.get("matcher_name") or properties.get("template_id") or ""
        raw = f"found_on|{src_id}|{dst_id}|{sig}"
        h = hashlib.sha256(raw.encode()).hexdigest()
        return f"edge_found_on:{h}"

    def merge_properties(self, existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
        return {**existing, **{k: v for k, v in incoming.items() if v not in (None, "", [])}}

    def merge_sources(self, existing: list[str], incoming: str) -> list[str]:
        s = set(existing)
        s.add(incoming)
        return sorted(s)

    def ui_hints(self) -> dict[str, Any]:
        return {"label": "found_on", "color": "#e74c3c"}
