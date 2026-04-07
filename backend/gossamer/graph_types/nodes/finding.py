"""Node type: Finding — vulnerability or scanner hit tied to an endpoint."""
from __future__ import annotations

import hashlib
from typing import Any


class FindingNode:
    kind = "Finding"

    def stable_id(self, key: str) -> str:
        h = hashlib.sha256(f"Finding:{key}".encode()).hexdigest()
        return f"finding:{h}"

    def merge_properties(self, existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
        out = {**existing}
        for k, v in incoming.items():
            if k not in out or out[k] in (None, "", []):
                out[k] = v
            elif k == "tags" and isinstance(v, list) and isinstance(out.get("tags"), list):
                out["tags"] = sorted(set(str(x) for x in out["tags"]) | set(str(x) for x in v))
        return out

    def ui_hints(self) -> dict[str, Any]:
        return {
            "label": "Finding",
            "color": "#e74c3c",
            "searchable": ["name", "template_id", "severity", "scanner", "matched_at"],
        }
