from __future__ import annotations

import hashlib
from typing import Any


class DetectedOnEdge:
    """Technology -> Endpoint: technology was detected on this endpoint."""
    kind = "detected_on"

    def stable_id(self, src_id: str, dst_id: str, properties: dict[str, Any]) -> str:
        raw = f"{src_id}|{dst_id}"
        h = hashlib.sha256(raw.encode()).hexdigest()
        return f"edge_detected_on:{h}"

    def merge_properties(self, existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
        out = {**existing}
        if "evidence" in incoming and isinstance(incoming["evidence"], list):
            prev = out.get("evidence", [])
            out["evidence"] = sorted(set(prev) | set(incoming["evidence"]))
        return out

    def merge_sources(self, existing: list[str], incoming: str) -> list[str]:
        return sorted(set(existing) | {incoming})

    def ui_hints(self) -> dict[str, Any]:
        return {"label": "detected on", "color": "#8b5cf6"}
