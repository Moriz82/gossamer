from __future__ import annotations

import json
import secrets
import shutil
import zipfile
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, FastAPI, File, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from gossamer.auth_deps import require_auth
from gossamer.config import Settings, get_settings
from gossamer.graph_store.base import GraphStore
from gossamer.graph_store.factory import create_graph_store
from gossamer.graph_store.neo4j_store import Neo4jGraphStore
from gossamer.graph_store.sqlite_store import SqliteGraphStore
from gossamer.graph_types.registry import graph_type_registry_payload
from gossamer.ingestors.catalog import INGESTOR_INFO
from gossamer.ingestors.registry import all_ingestors
from gossamer.normalizers.registry import all_normalizer_defs
from gossamer.plugin_store import (
    check_status as plugin_check_status,
    install_plugin,
    list_plugins,
    uninstall_plugin,
    update_plugin,
)
from gossamer.scanner_runner import run_scanner, stop_scanner
from gossamer.pipeline import ingest_and_store
from gossamer.queries.builtins import *  # noqa: F401,F403 - register builtins
from gossamer.queries.registry import all_queries, get_query
from gossamer.queries.yaml_loader import load_yaml_queries
from gossamer.scanner_templates import build_templates_zip, list_templates
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

_STORE: GraphStore | None = None


def get_store() -> GraphStore:
    if _STORE is None:
        raise RuntimeError("Store not initialized")
    return _STORE


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _STORE
    s = get_effective_settings()
    s.database_path.parent.mkdir(parents=True, exist_ok=True)
    s.uploads_dir.mkdir(parents=True, exist_ok=True)
    s.exports_dir.mkdir(parents=True, exist_ok=True)
    _config = s.database_path.parent / "config"
    _config.mkdir(parents=True, exist_ok=True)
    _STORE = create_graph_store(s)
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
    crawl_mode: Literal["crawl_only", "crawl_audit"] = "crawl_only"


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
def health(store: Annotated[GraphStore, Depends(get_store)]) -> dict[str, str]:
    backend = "neo4j" if isinstance(store, Neo4jGraphStore) else "sqlite"
    info = store.health_descriptor()
    return {"status": "ok", "backend": backend, "graph": info}


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
                "role": meta.get("role", "import"),
            }
        )
    return rows


@api.get("/normalizers")
def api_normalizers() -> list[dict[str, str]]:
    return all_normalizer_defs()


@api.get("/templates")
def api_templates_list() -> list[dict[str, Any]]:
    return list_templates()


@api.get("/templates/download")
def api_templates_download(
    ids: str | None = None,
    download_all: bool = Query(False, alias="all"),
) -> StreamingResponse:
    if download_all:
        id_list: list[str] | None = None
    elif ids and ids.strip():
        id_list = [x.strip() for x in ids.split(",") if x.strip()]
    else:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Use query all=1 to download every template or ids=id1,id2 for a subset.",
        )
    try:
        data, filename = build_templates_zip(id_list)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return StreamingResponse(
        BytesIO(data),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@api.get("/graph-type-registry")
def graph_type_registry() -> dict[str, Any]:
    return graph_type_registry_payload()


@api.get("/findings")
def api_findings(
    store: Annotated[GraphStore, Depends(get_store)],
    limit: int = 2000,
) -> dict[str, Any]:
    lim = max(1, min(limit, 50_000))
    rows = store.list_findings(lim)
    return {"findings": rows, "count": len(rows)}


def _enrich_snapshot(snap: dict[str, Any]) -> dict[str, Any]:
    """Add labels and colors from the type registry to a snapshot dict."""
    registry = graph_type_registry_payload()
    reg = registry["nodes"]
    ereg = registry["edges"]
    for n in snap["nodes"]:
        hints = reg.get(n["kind"], {})
        props = n["properties"]
        if n["kind"] == "Finding":
            n["label"] = (
                str(props.get("name") or props.get("template_id") or "Finding")
            )
        else:
            n["label"] = props.get("url") or props.get("hostname") or n["kind"]
        n["color"] = hints.get("color", "#888")
    for e in snap["edges"]:
        eh = ereg.get(e["kind"], {})
        e["color"] = eh.get("color", "#ccc")
    return snap


@api.get("/graph/stats")
def graph_stats(store: Annotated[GraphStore, Depends(get_store)]) -> dict[str, Any]:
    return store.get_graph_stats()


@api.get("/graph")
def graph_snapshot(
    store: Annotated[GraphStore, Depends(get_store)],
    kinds: str | None = Query(default=None, description="Comma-separated node kinds to include"),
    exclude_kinds: str | None = Query(default=None, description="Comma-separated node kinds to exclude"),
    limit: int = Query(default=5000, ge=1, le=50000, description="Max nodes to return"),
) -> dict[str, Any]:
    include = [k.strip() for k in kinds.split(",") if k.strip()] if kinds else None
    exclude = [k.strip() for k in exclude_kinds.split(",") if k.strip()] if exclude_kinds else None
    if include or exclude or limit != 5000:
        snap = store.get_filtered_snapshot(
            include_kinds=include, exclude_kinds=exclude, limit=limit,
        )
    else:
        snap = store.get_graph_snapshot()
    return _enrich_snapshot(snap)


@api.post("/ingest")
async def ingest_upload(
    store: Annotated[GraphStore, Depends(get_store)],
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
    store: Annotated[GraphStore, Depends(get_store)],
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
    store: Annotated[GraphStore, Depends(get_store)],
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
    if body.crawl_mode == "crawl_audit":
        extra["audit"] = True
    stats = ingest_and_store(
        store,
        p,
        body.source_label,
        "crawl_seed",
        settings,
        extra_options=extra,
    )
    return {"ok": True, **stats}


@api.post("/ingest/crawl/stream")
def ingest_crawl_stream(
    body: CrawlOptions,
    store: Annotated[GraphStore, Depends(get_store)],
    settings: Annotated[Settings, Depends(get_effective_settings)],
) -> StreamingResponse:
    """SSE endpoint that streams crawl progress events."""
    import queue as _queue
    import threading

    p = Path(body.seeds_file).expanduser()
    if not p.is_file():
        raise HTTPException(404, f"not a file: {p}")

    progress_q: _queue.Queue[dict[str, Any]] = _queue.Queue()

    extra: dict[str, Any] = {}
    if body.max_depth is not None:
        extra["max_depth"] = body.max_depth
    if body.max_pages is not None:
        extra["max_pages"] = body.max_pages
    if body.scope_hosts is not None:
        extra["scope_hosts"] = body.scope_hosts
    if body.cookies is not None:
        extra["cookies"] = body.cookies
    if body.crawl_mode == "crawl_audit":
        extra["audit"] = True
    extra["progress_callback"] = lambda evt: progress_q.put(evt)

    def _run() -> None:
        try:
            stats = ingest_and_store(
                store, p, body.source_label, "crawl_seed", settings,
                extra_options=extra,
            )
            progress_q.put({"type": "complete", **stats})
        except Exception as exc:
            progress_q.put({"type": "error", "detail": str(exc)})

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()

    def event_stream():
        while True:
            try:
                evt = progress_q.get(timeout=120)
            except _queue.Empty:
                yield "data: {\"type\": \"heartbeat\"}\n\n"
                continue
            yield f"data: {json.dumps(evt)}\n\n"
            if evt.get("type") in ("complete", "error"):
                break

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@api.delete("/graph")
def graph_clear(store: Annotated[GraphStore, Depends(get_store)]) -> dict[str, bool]:
    store.clear()
    return {"ok": True}


@api.get("/queries")
def list_queries() -> list[dict[str, str]]:
    return [{"name": q.name, "description": q.description} for q in all_queries()]


@api.post("/queries/{name}/run")
def run_query(
    name: str,
    store: Annotated[GraphStore, Depends(get_store)],
) -> list[dict[str, Any]]:
    q = get_query(name)
    if not q:
        raise HTTPException(404, "unknown query")
    try:
        return q.run(store)
    except RuntimeError as exc:
        if "SQLite graph backend" in str(exc):
            raise HTTPException(
                status.HTTP_501_NOT_IMPLEMENTED,
                "This query is SQL-only; use the SQLite backend or a built-in query.",
            ) from exc
        raise


@api.post("/export/bundle")
def export_bundle(
    store: Annotated[GraphStore, Depends(get_store)],
    settings: Annotated[Settings, Depends(get_effective_settings)],
) -> JSONResponse:
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    zip_path = settings.exports_dir / f"gossamer-bundle-{ts}.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        if isinstance(store, Neo4jGraphStore):
            payload = store.export_graph_dict()
            manifest = {"version": 1, "exported_at": ts, "backend": "neo4j"}
            zf.writestr("graph.json", json.dumps(payload, indent=2))
        else:
            assert isinstance(store, SqliteGraphStore)
            manifest = {
                "version": 1,
                "exported_at": ts,
                "backend": "sqlite",
                "database": store.path.name,
            }
            zf.write(store.path, arcname=store.path.name)
        zf.writestr("manifest.json", json.dumps(manifest, indent=2))
    return JSONResponse({"ok": True, "path": str(zip_path)})


class ImportBundleBody(BaseModel):
    zip_path: str
    replace: bool = True


class GraphPathBody(BaseModel):
    from_id: str = Field(..., min_length=1)
    to_id: str = Field(..., min_length=1)
    max_hops: int | None = Field(default=None, ge=1, le=50)


@api.get("/nodes/{node_id}/neighbors")
def node_neighbors(
    node_id: str,
    store: Annotated[GraphStore, Depends(get_store)],
    direction: str = "both",
) -> dict[str, Any]:
    if direction not in ("in", "out", "both"):
        raise HTTPException(400, "direction must be in, out, or both")
    try:
        return store.get_neighbors(node_id, direction=direction)
    except NotImplementedError as exc:
        raise HTTPException(
            status.HTTP_501_NOT_IMPLEMENTED,
            "Neighbors are not implemented for this graph backend.",
        ) from exc


@api.post("/graph/path")
def graph_path(
    body: GraphPathBody,
    store: Annotated[GraphStore, Depends(get_store)],
    settings: Annotated[Settings, Depends(get_effective_settings)],
) -> dict[str, Any]:
    if not store.supports_path_queries():
        raise HTTPException(
            status.HTTP_501_NOT_IMPLEMENTED,
            "Shortest-path search requires the Neo4j graph backend (GOSSAMER_NEO4J_URI).",
        )
    if not isinstance(store, Neo4jGraphStore):
        raise HTTPException(500, "Store mismatch for path query")
    mh = body.max_hops if body.max_hops is not None else settings.graph_path_max_hops
    result = store.shortest_path(body.from_id, body.to_id, max_hops=mh)
    if result is None:
        raise HTTPException(404, "No path found")
    return result


@api.post("/import/bundle")
def import_bundle(
    body: ImportBundleBody,
    store: Annotated[GraphStore, Depends(get_store)],
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
    manifest: dict[str, Any] = {}
    mp = tmp / "manifest.json"
    if mp.is_file():
        try:
            manifest = json.loads(mp.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            manifest = {}
    backend = str(manifest.get("backend") or "").lower()
    graph_json = tmp / "graph.json"
    db_files = list(tmp.glob("*.sqlite*")) + list(tmp.glob("*.db"))
    use_neo4j_bundle = graph_json.is_file() and (backend == "neo4j" or not db_files)

    if use_neo4j_bundle:
        if not isinstance(store, Neo4jGraphStore):
            shutil.rmtree(tmp, ignore_errors=True)
            raise HTTPException(
                400,
                "Bundle contains a Neo4j graph export; set GOSSAMER_NEO4J_URI and restart to use Neo4j before re-importing.",
            )
        data = json.loads(graph_json.read_text(encoding="utf-8"))
        store.import_graph_dict(data)
        shutil.rmtree(tmp, ignore_errors=True)
        return {"ok": True, "backend": "neo4j"}

    if isinstance(store, Neo4jGraphStore):
        shutil.rmtree(tmp, ignore_errors=True)
        raise HTTPException(
            400,
            "SQLite database bundles cannot be imported while GOSSAMER_NEO4J_URI is set; "
            "use a Neo4j export zip or restart without Neo4j to import SQLite.",
        )

    assert isinstance(store, SqliteGraphStore)
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
    _STORE = create_graph_store(settings)
    return {"ok": True, "database": str(settings.database_path), "backend": "sqlite"}


@api.get("/plugins")
def api_plugins() -> list[dict[str, Any]]:
    return list_plugins()


@api.get("/plugins/{plugin_id}/status")
def api_plugin_status(plugin_id: str) -> dict[str, Any]:
    return plugin_check_status(plugin_id)


@api.post("/plugins/{plugin_id}/install")
def api_plugin_install(plugin_id: str) -> dict[str, Any]:
    return install_plugin(plugin_id)


@api.post("/plugins/{plugin_id}/update")
def api_plugin_update(plugin_id: str) -> dict[str, Any]:
    return update_plugin(plugin_id)


@api.delete("/plugins/{plugin_id}")
def api_plugin_uninstall(plugin_id: str) -> dict[str, Any]:
    return uninstall_plugin(plugin_id)


@api.post("/scanners/{plugin_id}/run")
def api_scanner_run(
    plugin_id: str,
    body: dict[str, Any],
    store: Annotated[GraphStore, Depends(get_store)],
    settings: Annotated[Settings, Depends(get_effective_settings)],
) -> StreamingResponse:
    """SSE endpoint that streams scanner execution progress."""
    import queue as _queue
    import threading

    targets = body.get("targets", [])
    extra_args = body.get("extra_args", [])

    progress_q: _queue.Queue[dict[str, Any]] = _queue.Queue()

    def _run() -> None:
        try:
            result = run_scanner(
                plugin_id,
                targets,
                progress_cb=lambda evt: progress_q.put(evt),
                extra_args=extra_args,
            )
            # Auto-ingest if output file exists
            if result.get("ok") and result.get("output_file"):
                stats = ingest_and_store(
                    store,
                    Path(result["output_file"]),
                    f"scan_{plugin_id}",
                    result.get("ingestor"),
                    settings,
                )
                result["ingested"] = stats
                Path(result["output_file"]).unlink(missing_ok=True)
            progress_q.put({"type": "complete", **result})
        except Exception as exc:
            progress_q.put({"type": "error", "detail": str(exc)})

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()

    def event_stream():
        while True:
            try:
                evt = progress_q.get(timeout=120)
            except _queue.Empty:
                yield 'data: {"type": "heartbeat"}\n\n'
                continue
            yield f"data: {json.dumps(evt)}\n\n"
            if evt.get("type") in ("complete", "error"):
                break

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@api.post("/scanners/{plugin_id}/stop")
def api_scanner_stop(plugin_id: str) -> dict[str, Any]:
    """Stop a running scanner."""
    return stop_scanner(plugin_id)


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
