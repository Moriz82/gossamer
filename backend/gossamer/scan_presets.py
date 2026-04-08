"""Scan presets — bundled configurations for crawl + scanner pipelines."""
from __future__ import annotations

from typing import Any


PRESETS: dict[str, dict[str, Any]] = {
    "light": {
        "name": "light",
        "description": "Passive audit only — crawl with header/status checks, no external scanners",
        "audit": True,
        "scanners": [],
    },
    "medium": {
        "name": "medium",
        "description": "Passive audit + Nuclei with safe tags (low/medium/high severity)",
        "audit": True,
        "scanners": [
            {
                "plugin_id": "nuclei",
                "extra_args": ["-severity", "low,medium,high", "-tags", "safe"],
            },
        ],
    },
    "full": {
        "name": "full",
        "description": "Passive audit + all installed scanners with default arguments",
        "audit": True,
        "scanners": "__all_installed__",
    },
}


def list_presets() -> list[dict[str, Any]]:
    """List all scan presets with their descriptions."""
    result = []
    for preset in PRESETS.values():
        scanners = preset["scanners"]
        if scanners == "__all_installed__":
            scanner_desc = "All installed scanners"
        elif isinstance(scanners, list):
            scanner_desc = ", ".join(s["plugin_id"] for s in scanners) if scanners else "None"
        else:
            scanner_desc = "Unknown"
        result.append({
            "name": preset["name"],
            "description": preset["description"],
            "audit": preset["audit"],
            "scanner_summary": scanner_desc,
        })
    return result


def get_preset(name: str) -> dict[str, Any] | None:
    """Get a preset by name."""
    return PRESETS.get(name)


def resolve_scanners(preset: dict[str, Any], installed_plugins: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Resolve the scanner list for a preset, expanding __all_installed__."""
    scanners = preset.get("scanners", [])
    if scanners == "__all_installed__":
        return [
            {"plugin_id": p["id"], "extra_args": []}
            for p in installed_plugins
            if p.get("installed") and p.get("binary_found")
        ]
    return scanners if isinstance(scanners, list) else []
