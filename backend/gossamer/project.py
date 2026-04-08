"""Project management for Gossamer — isolated workspaces with separate databases."""
from __future__ import annotations

import json
import shutil
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


@dataclass
class Project:
    name: str
    path: Path
    created_at: str
    database_path: Path
    responses_dir: Path
    exports_dir: Path


def _projects_dir() -> Path:
    d = Path.home() / ".gossamer" / "projects"
    d.mkdir(parents=True, exist_ok=True)
    return d


def create_project(name: str) -> Project:
    safe = name.strip().replace("/", "_").replace("\\", "_")
    if not safe:
        raise ValueError("Project name cannot be empty")
    proj_dir = _projects_dir() / safe
    db_dir = proj_dir / "db"
    resp_dir = proj_dir / "responses"
    exp_dir = proj_dir / "exports"
    db_dir.mkdir(parents=True, exist_ok=True)
    resp_dir.mkdir(parents=True, exist_ok=True)
    exp_dir.mkdir(parents=True, exist_ok=True)
    meta_path = proj_dir / "meta.json"
    if meta_path.exists():
        meta = json.loads(meta_path.read_text())
    else:
        meta = {"name": safe, "created_at": datetime.now(timezone.utc).isoformat()}
        meta_path.write_text(json.dumps(meta, indent=2))
    return Project(
        name=safe, path=proj_dir, created_at=meta["created_at"],
        database_path=db_dir / "graph.sqlite", responses_dir=resp_dir, exports_dir=exp_dir,
    )


def open_project(name: str) -> Project:
    proj_dir = _projects_dir() / name
    meta_path = proj_dir / "meta.json"
    if not meta_path.exists():
        raise FileNotFoundError(f"Project not found: {name}")
    meta = json.loads(meta_path.read_text())
    return Project(
        name=name, path=proj_dir, created_at=meta.get("created_at", ""),
        database_path=proj_dir / "db" / "graph.sqlite",
        responses_dir=proj_dir / "responses", exports_dir=proj_dir / "exports",
    )


def list_projects() -> list[dict[str, Any]]:
    projects_dir = _projects_dir()
    result = []
    for d in sorted(projects_dir.iterdir()):
        meta_path = d / "meta.json"
        if not d.is_dir() or not meta_path.exists():
            continue
        meta = json.loads(meta_path.read_text())
        db_path = d / "db" / "graph.sqlite"
        result.append({
            "name": meta.get("name", d.name), "created_at": meta.get("created_at", ""),
            "has_database": db_path.exists(),
            "size_bytes": db_path.stat().st_size if db_path.exists() else 0,
        })
    return result


def delete_project(name: str) -> None:
    if name == "default":
        raise ValueError("Cannot delete the default project")
    proj_dir = _projects_dir() / name
    if not proj_dir.exists():
        raise FileNotFoundError(f"Project not found: {name}")
    shutil.rmtree(proj_dir)


def export_project(name: str, format: str = "zip") -> Path:
    proj = open_project(name)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    zip_path = proj.exports_dir / f"{name}-export-{ts}.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        if proj.database_path.exists():
            zf.write(proj.database_path, arcname="db/graph.sqlite")
        if proj.responses_dir.exists():
            for f in proj.responses_dir.rglob("*"):
                if f.is_file():
                    zf.write(f, arcname=f"responses/{f.relative_to(proj.responses_dir)}")
        meta_path = proj.path / "meta.json"
        if meta_path.exists():
            zf.write(meta_path, arcname="meta.json")
        manifest = {"version": 1, "project": name, "exported_at": ts, "format": format}
        zf.writestr("manifest.json", json.dumps(manifest, indent=2))
    return zip_path


def import_project(zip_path: Path, name: str | None = None) -> Project:
    if not zip_path.exists():
        raise FileNotFoundError(f"Zip file not found: {zip_path}")
    with zipfile.ZipFile(zip_path, "r") as zf:
        try:
            manifest = json.loads(zf.read("manifest.json"))
        except (KeyError, json.JSONDecodeError):
            manifest = {}
    proj_name = name or manifest.get("project", zip_path.stem)
    proj_dir = _projects_dir() / proj_name
    if proj_dir.exists():
        raise ValueError(f"Project already exists: {proj_name}")
    proj_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(proj_dir)
    (proj_dir / "db").mkdir(exist_ok=True)
    (proj_dir / "responses").mkdir(exist_ok=True)
    (proj_dir / "exports").mkdir(exist_ok=True)
    meta_path = proj_dir / "meta.json"
    if not meta_path.exists():
        meta = {"name": proj_name, "created_at": datetime.now(timezone.utc).isoformat()}
        meta_path.write_text(json.dumps(meta, indent=2))
    return open_project(proj_name)
