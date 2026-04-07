from __future__ import annotations

import hashlib
from typing import Any


class ServesEdge:
    kind = "serves"

    def stable_id(self, src_id: str, dst_id: str, properties: dict[str, Any]) -> str:
        raw = f"{src_id}|{dst_id}|{properties.get('scheme', '')}"
        h = hashlib.sha256(raw.encode()).hexdigest()
        return f"edge_serves:{h}"

    def merge_properties(self, existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
        return {**existing, **{k: v for k, v in incoming.items() if v not in (None, "", [])}}

    def merge_sources(self, existing: list[str], incoming: str) -> list[str]:
        s = set(existing)
        s.add(incoming)
        return sorted(s)

    def ui_hints(self) -> dict[str, Any]:
        return {"label": "serves", "color": "#aaa"}
