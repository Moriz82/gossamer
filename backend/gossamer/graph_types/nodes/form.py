"""Node type: Form -- discovered HTML form."""
from __future__ import annotations

import hashlib
from typing import Any


class FormNode:
    kind = "Form"

    def stable_id(self, key: str) -> str:
        h = hashlib.sha256(f"Form:{key}".encode()).hexdigest()
        return f"form:{h}"

    def merge_properties(self, existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
        out = {**existing}
        for k, v in incoming.items():
            if k not in out or out[k] in (None, "", []):
                out[k] = v
        return out

    def ui_hints(self) -> dict[str, Any]:
        return {
            "label": "Form",
            "color": "#f39c12",
            "searchable": ["action_url", "method"],
        }
