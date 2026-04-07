from __future__ import annotations

import json
import secrets
import shutil
import zipfile
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, FastAPI, File, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from gossamer.auth_deps import require_auth
from gossamer.config import Settings, get_settings
from gossamer.graph_store.sqlite_store import SqliteGraphStore
from gossamer.graph_types.registry import graph_type_registry_payload
from gossamer.ingestors.catalog import INGESTOR_INFO
from gossamer.ingestors.registry import all_ingestors
from gossamer.normalizers.registry import all_normalizer_defs
from gossamer.pipeline import ingest_and_store
from gossamer.queries.builtins import *  # noqa: F401,F403 - register builtins
from gossamer.queries.registry import all_queries, get_query
from gossamer.queries.yaml_loader import load_yaml_queries
from gossamer.runtime_settings import (
    clear_runtime_auth,
    env_settings_public,
    get_effective_auth_credentials,
    get_effective_settings,
    load_runtime_payload,
    patch_runtime,
    runtime_public_dict,
    set_runtime_auth,
    settings_public_dict,
)

_STORE: SqliteGraphStore | None = None


def get_store() -> SqliteGraphStore:
    if _STORE is None:
        raise RuntimeError("Store not initialized")
    return _STORE


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _STORE
    s = get_settings()
    s.database_path.parent.mkdir(parents=True, exist_ok=True)
    s.uploads_dir.mkdir(parents=True, exist_ok=True)
    s.exports_dir.mkdir(parents=True, exist_ok=True)
    _config = s.database_path.parent / "config"
    _config.mkdir(parents=True, exist_ok=True)
    _STORE = SqliteGraphStore(s.database_path)
    backend_dir = Path(__file__).resolve().parent
    load_yaml_queries(backend_dir / "queries" / "custom")
    yield
    if _STORE:
        _STORE.close()
    _STORE = None


app = FastAPI(title="Gossamer", lifespan=lifespan)
_settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api = APIRouter(prefix="/api", dependencies=[Depends(require_auth)])


class IngestRequest(BaseModel):
    path: str | None = None
    source_label: str = Field(default="import")
    ingestor_hint: str | None = None


class CrawlOptions(BaseModel):
    seeds_file: str
    source_label: str = "crawl"
    max_depth: int | None = None
    max_pages: int | None = None
    scope_hosts: list[str] | None = None
    cookies: dict[str, str] | None = None


class SettingsPatchBody(BaseModel):
    pipeline: dict[str, Any] | None = None
    ui: dict[str, Any] | None = None


class AuthChangeBody(BaseModel):
    current_password: str = Field(..., min_length=1)
    new_username: str | None = None
    new_password: str | None = None
    revert_to_environment: bool = False


def _auth_info(env: Settings) -> dict[str, Any]:
    eu, _ep = get_effective_auth_credentials(env)
    payload = load_runtime_payload(env)
    runtime_on = bool(payload.auth.username and payload.auth.password)
    return {
        "auth_disabled": env.auth_disabled,
        "effective_username": eu,
        "env_username": env.auth_username,
        "runtime_override_active": runtime_on,
        "password_configured": True,
    }


@api.get("/health")
def health(store: Annotated[SqliteGraphStore, Depends(get_store)]) -> dict[str, str]:
    return {"status": "ok", "db": str(store.path)}


@api.get("/settings")
def api_settings(env: Annotated[Settings, Depends(get_settings)]) -> dict[str, Any]:
    effective = get_effective_settings()
    payload = load_runtime_payload(env)
    return {
        "auth": _auth_info(env),
        "env_paths": {
            "database_path": str(env.database_path),
            "uploads_dir": str(env.uploads_dir),
            "exports_dir": str(env.exports_dir),
        },
        "env": env_settings_public(env),
        "notes": [
            "Paths are read from environment only; change GOSSAMER_* and restart to relocate data.",
            "CORS allow-list is fixed at process start; changing origins below applies to saved config but may require a restart to affect browsers.",
            "Runtime JSON can override HTTP Basic username/password (stored on disk beside the DB); use Settings → Credentials in the UI.",
        ],
        "effective": settings_public_dict(effective),
        "runtime": runtime_public_dict(payload),
    }


@api.patch("/settings")
def api_settings_patch(
    body: SettingsPatchBody,
    env: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    merged = patch_runtime(
        env,
        {k: v for k, v in {"pipeline": body.pipeline, "ui": body.ui}.items() if v is not None},
    )
    effective = get_effective_settings()
    return {
        "ok": True,
        "effective": settings_public_dict(effective),
        "runtime": runtime_public_dict(merged),
    }


@api.post("/settings/auth")
def api_change_auth(
    body: AuthChangeBody,
    env: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    if env.auth_disabled:
        raise HTTPException(400, "Authentication is disabled (GOSSAMER_AUTH_DISABLED).")
    eu, ep = get_effective_auth_credentials(env)
    if not secrets.compare_digest(body.current_password, ep):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Current password is incorrect.",
        )
    if body.revert_to_environment:
        clear_runtime_auth(env)
        return {
            "ok": True,
            "runtime": runtime_public_dict(load_runtime_payload(env)),
            "message": "Login now uses GOSSAMER_AUTH_USERNAME / GOSSAMER_AUTH_PASSWORD from the environment.",
        }
    nu = (body.new_username.strip() if body.new_username else eu) or eu
    np = ep if body.new_password is None else body.new_password
    if not np:
        raise HTTPException(400, "New password cannot be empty.")
    set_runtime_auth(env, nu, np)
    return {
        "ok": True,
        "runtime": runtime_public_dict(load_runtime_payload(env)),
        "message": "Credentials updated. Sign in again in the browser with the new username/password.",
    }


@api.get("/ingestors")
def api_ingestors() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for ing in all_ingestors():
        meta = INGESTOR_INFO.get(ing.name, {})
        rows.append(
            {
                "name": ing.name,
                "summary": meta.get("summary", ""),
                "hints": meta.get("hints", ""),
            }
        )
    return rows


@api.get("/normalizers")
def api_normalizers() -> list[dict[str, str]]:
    return all_normalizer_defs()


@api.get("/graph-type-registry")
def graph_type_registry() -> dict[str, Any]:
    return graph_type_registry_payload()


@api.get("/graph")
def graph_snapshot(store: Annotated[SqliteGraphStore, Depends(get_store)]) -> dict[str, Any]:
    snap = store.get_graph_snapshot()
    reg = graph_type_registry_payload()["nodes"]
    ereg = graph_type_registry_payload()["edges"]
    for n in snap["nodes"]:
        hints = reg.get(n["kind"], {})
        n["label"] = n["properties"].get("url") or n["properties"].get("hostname") or n["kind"]
        n["color"] = hints.get("color", "#888")
    for e in snap["edges"]:
        eh = ereg.get(e["kind"], {})
        e["color"] = eh.get("color", "#ccc")
    return snap


@api.post("/ingest")
async def ingest_upload(
    store: Annotated[SqliteGraphStore, Depends(get_store)],
    settings: Annotated[Settings, Depends(get_effective_settings)],
    file: UploadFile = File(...),
    source_label: str = "upload",
    ingestor_hint: str | None = None,
) -> dict[str, Any]:
    safe_name = Path(file.filename or "upload").name
    dest = settings.uploads_dir / f"{datetime.now(timezone.utc).timestamp():.0f}_{safe_name}"
    dest.write_bytes(await file.read())
    stats = ingest_and_store(store, dest, source_label, ingestor_hint, settings)
    return {"ok": True, "file": str(dest), **stats}


@api.post("/ingest/path")
def ingest_path(
    body: IngestRequest,
    store: Annotated[SqliteGraphStore, Depends(get_store)],
    settings: Annotated[Settings, Depends(get_effective_settings)],
) -> dict[str, Any]:
    if not body.path:
        raise HTTPException(400, "path required")
    p = Path(body.path).expanduser()
    if not p.is_file():
        raise HTTPException(404, f"not a file: {p}")
    stats = ingest_and_store(store, p, body.source_label, body.ingestor_hint, settings)
    return {"ok": True, **stats}


@api.post("/ingest/crawl")
def ingest_crawl(
    body: CrawlOptions,
    store: Annotated[SqliteGraphStore, Depends(get_store)],
    settings: Annotated[Settings, Depends(get_effective_settings)],
) -> dict[str, Any]:
    p = Path(body.seeds_file).expanduser()
    if not p.is_file():
        raise HTTPException(404, f"not a file: {p}")
    extra: dict[str, Any] = {}
    if body.max_depth is not None:
        extra["max_depth"] = body.max_depth
    if body.max_pages is not None:
        extra["max_pages"] = body.max_pages
    if body.scope_hosts is not None:
        extra["scope_hosts"] = body.scope_hosts
    if body.cookies is not None:
        extra["cookies"] = body.cookies
    stats = ingest_and_store(
        store,
        p,
        body.source_label,
        "crawl_seed",
        settings,
        extra_options=extra,
    )
    return {"ok": True, **stats}


@api.delete("/graph")
def graph_clear(store: Annotated[SqliteGraphStore, Depends(get_store)]) -> dict[str, bool]:
    store.clear()
    return {"ok": True}


@api.get("/queries")
def list_queries() -> list[dict[str, str]]:
    return [{"name": q.name, "description": q.description} for q in all_queries()]


@api.post("/queries/{name}/run")
def run_query(
    name: str,
    store: Annotated[SqliteGraphStore, Depends(get_store)],
) -> list[dict[str, Any]]:
    q = get_query(name)
    if not q:
        raise HTTPException(404, "unknown query")
    conn = store._conn
    return q.run(conn)


@api.post("/export/bundle")
def export_bundle(
    store: Annotated[SqliteGraphStore, Depends(get_store)],
    settings: Annotated[Settings, Depends(get_effective_settings)],
) -> JSONResponse:
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    zip_path = settings.exports_dir / f"gossamer-bundle-{ts}.zip"
    manifest = {
        "version": 1,
        "exported_at": ts,
        "database": store.path.name,
    }
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(store.path, arcname=store.path.name)
        zf.writestr("manifest.json", json.dumps(manifest, indent=2))
    return JSONResponse({"ok": True, "path": str(zip_path)})


class ImportBundleBody(BaseModel):
    zip_path: str
    replace: bool = True


@api.post("/import/bundle")
def import_bundle(
    body: ImportBundleBody,
    store: Annotated[SqliteGraphStore, Depends(get_store)],
    settings: Annotated[Settings, Depends(get_effective_settings)],
) -> dict[str, Any]:
    zpath = Path(body.zip_path).expanduser()
    if not zpath.is_file():
        raise HTTPException(404, "zip not found")
    global _STORE
    tmp = settings.exports_dir / "_import_extract"
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zpath, "r") as zf:
        zf.extractall(tmp)
    db_files = list(tmp.glob("*.sqlite*")) + list(tmp.glob("*.db"))
    target_name = settings.database_path.name
    chosen: Path | None = tmp / target_name if (tmp / target_name).is_file() else None
    if chosen is None and db_files:
        chosen = db_files[0]
    if chosen is None or not chosen.is_file():
        shutil.rmtree(tmp, ignore_errors=True)
        raise HTTPException(400, "no sqlite database inside bundle")
    settings.database_path.parent.mkdir(parents=True, exist_ok=True)
    store.close()
    if body.replace and settings.database_path.exists():
        settings.database_path.unlink()
    shutil.copy(chosen, settings.database_path)
    shutil.rmtree(tmp, ignore_errors=True)
    _STORE = SqliteGraphStore(settings.database_path)
    return {"ok": True, "database": str(settings.database_path)}


app.include_router(api)


def custom_openapi() -> dict[str, Any]:
    if app.openapi_schema:
        return app.openapi_schema
    openapi_schema = get_openapi(
        title=app.title,
        version="0.1.0",
        routes=app.routes,
    )
    openapi_schema.setdefault("components", {}).setdefault("securitySchemes", {})["HTTPBasic"] = {
        "type": "http",
        "scheme": "basic",
    }
    openapi_schema["security"] = [{"HTTPBasic": []}]
    app.openapi_schema = openapi_schema
    return app.openapi_schema


app.openapi = custom_openapi  # type: ignore[method-assign]
