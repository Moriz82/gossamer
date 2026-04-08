from __future__ import annotations

import hashlib
from typing import Any


class TechnologyNode:
    kind = "Technology"

    def stable_id(self, key: str) -> str:
        k = key.strip().lower()
        h = hashlib.sha256(f"Technology:{k}".encode()).hexdigest()
        return f"tech:{h}"

    def merge_properties(self, existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
        out = {**existing}
        for k, v in incoming.items():
            if k == "confidence":
                out[k] = max(out.get(k, 0), v or 0)
            elif k == "evidence" and isinstance(v, list):
                prev = out.get(k, [])
                out[k] = sorted(set(prev) | set(v))
            elif k not in out or out[k] in (None, "", []):
                out[k] = v
        return out

    def ui_hints(self) -> dict[str, Any]:
        return {
            "label": "Technology",
            "color": "#a78bfa",
            "searchable": ["name", "version", "categories"],
        }
