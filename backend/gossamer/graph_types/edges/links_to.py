from __future__ import annotations

import hashlib
from typing import Any


class LinksToEdge:
    kind = "links_to"

    def stable_id(self, src_id: str, dst_id: str, properties: dict[str, Any]) -> str:
        raw = f"{self.kind}|{src_id}|{dst_id}|{properties.get('via', '')}"
        h = hashlib.sha256(raw.encode()).hexdigest()
        return f"edge_links_to:{h}"

    def merge_properties(self, existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
        return {**existing, **{k: v for k, v in incoming.items() if v not in (None, "", [])}}

    def merge_sources(self, existing: list[str], incoming: str) -> list[str]:
        s = set(existing)
        s.add(incoming)
        return sorted(s)

    def ui_hints(self) -> dict[str, Any]:
        return {"label": "links_to", "color": "#2ecc71"}
