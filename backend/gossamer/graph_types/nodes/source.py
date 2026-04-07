from __future__ import annotations

import hashlib
from typing import Any


class SourceNode:
    kind = "Source"

    def stable_id(self, key: str) -> str:
        h = hashlib.sha256(f"Source:{key}".encode()).hexdigest()
        return f"source:{h}"

    def merge_properties(self, existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
        return {**existing, **{k: v for k, v in incoming.items() if v}}

    def ui_hints(self) -> dict[str, Any]:
        return {
            "label": "Source",
            "color": "#95a5a6",
            "searchable": ["name", "ingestor"],
        }
