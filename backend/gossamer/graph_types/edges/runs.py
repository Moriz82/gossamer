from __future__ import annotations

import hashlib
from typing import Any


class RunsEdge:
    """Host -> Technology: this host runs this technology."""
    kind = "runs"

    def stable_id(self, src_id: str, dst_id: str, properties: dict[str, Any]) -> str:
        raw = f"{src_id}|{dst_id}"
        h = hashlib.sha256(raw.encode()).hexdigest()
        return f"edge_runs:{h}"

    def merge_properties(self, existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
        return {**existing, **{k: v for k, v in incoming.items() if v not in (None, "", [])}}

    def merge_sources(self, existing: list[str], incoming: str) -> list[str]:
        return sorted(set(existing) | {incoming})

    def ui_hints(self) -> dict[str, Any]:
        return {"label": "runs", "color": "#a78bfa"}
