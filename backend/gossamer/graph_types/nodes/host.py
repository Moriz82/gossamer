from __future__ import annotations

import hashlib
from typing import Any


class HostNode:
    kind = "Host"

    def stable_id(self, key: str) -> str:
        k = key.strip().lower()
        h = hashlib.sha256(f"Host:{k}".encode()).hexdigest()
        return f"host:{h}"

    def merge_properties(self, existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
        out = {**existing}
        for k, v in incoming.items():
            if k not in out or out[k] in (None, "", []):
                out[k] = v
            elif isinstance(v, list) and isinstance(out[k], list):
                out[k] = sorted(set(out[k]) | set(v))
        return out

    def ui_hints(self) -> dict[str, Any]:
        return {
            "label": "Host",
            "color": "#4ecdc4",
            "searchable": ["hostname", "ip"],
        }
