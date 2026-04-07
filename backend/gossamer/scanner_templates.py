"""Bundled example scanner exports under examples/scanners (zip download for UI)."""
from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path
from typing import Any


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def templates_dir() -> Path:
    return _repo_root() / "examples" / "scanners"


def list_templates() -> list[dict[str, Any]]:
    d = templates_dir()
    if not d.is_dir():
        return []
    manifest = d / "manifest.json"
    entries: list[dict[str, Any]] = []
    if manifest.is_file():
        raw = json.loads(manifest.read_text(encoding="utf-8"))
        for t in raw.get("templates") or []:
            if not isinstance(t, dict):
                continue
            fn = str(t.get("file") or "")
            tid = str(t.get("id") or "").strip()
            if not fn or not tid:
                continue
            fp = d / fn
            if not fp.is_file():
                continue
            entries.append(
                {
                    "id": tid,
                    "file": fn,
                    "title": str(t.get("title") or tid),
                    "description": str(t.get("description") or ""),
                    "ingestor_hint": str(t.get("ingestor_hint") or ""),
                    "size_bytes": fp.stat().st_size,
                }
            )
        return sorted(entries, key=lambda x: x["id"])
    for fp in sorted(d.glob("*")):
        if fp.suffix.lower() not in (".json", ".jsonl", ".ndjson"):
            continue
        entries.append(
            {
                "id": fp.stem.replace(" ", "-"),
                "file": fp.name,
                "title": fp.stem,
                "description": "",
                "ingestor_hint": "",
                "size_bytes": fp.stat().st_size,
            }
        )
    return entries


def build_templates_zip(template_ids: list[str] | None) -> tuple[bytes, str]:
    """
    Build a zip of template files. template_ids None or empty means all listed templates.
    Raises ValueError for unknown ids.
    """
    entries = list_templates()
    if not entries:
        raise ValueError("No scanner templates are bundled (examples/scanners missing).")
    if template_ids:
        id_set = {e["id"] for e in entries}
        unknown = [i for i in template_ids if i not in id_set]
        if unknown:
            raise ValueError(f"Unknown template id(s): {', '.join(unknown)}")
        chosen = [e for e in entries if e["id"] in template_ids]
    else:
        chosen = entries
    root = templates_dir()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for e in chosen:
            fp = root / e["file"]
            zf.write(fp, arcname=f"scanner-templates/{e['file']}")
        readme = (
            "Gossamer bundled scanner template samples.\n"
            "Ingest via path or upload; use ingestor_hint from the manifest when auto-detect fails.\n"
        )
        zf.writestr("scanner-templates/README.txt", readme)
    name = f"gossamer-scanner-templates-{len(chosen)}.zip"
    return buf.getvalue(), name
