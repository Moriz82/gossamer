from __future__ import annotations

import hashlib
from typing import Any


class EndpointNode:
    kind = "Endpoint"

    def stable_id(self, key: str) -> str:
        h = hashlib.sha256(f"Endpoint:{key}".encode()).hexdigest()
        return f"endpoint:{h}"

    def merge_properties(self, existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
        out = {**existing}
        for k, v in incoming.items():
            if k == "sources_seen":
                prev = set(out.get(k) or [])
                prev |= set(v) if isinstance(v, list) else {v}
                out[k] = sorted(prev)
                continue
            if k not in out or out[k] in (None, "", []):
                out[k] = v
            elif isinstance(v, list) and isinstance(out[k], list):
                out[k] = sorted(set(out[k]) | set(v))
        return out

    def ui_hints(self) -> dict[str, Any]:
        return {
            "label": "Endpoint",
            "color": "#ff6b6b",
            "searchable": ["url", "method", "status_code"],
        }
