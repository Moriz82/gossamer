from __future__ import annotations

import json
from pathlib import Path
from threading import Lock
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from gossamer.config import Settings

_PATCH_LOCK = Lock()
_RUNTIME_SUBDIR = "config"


class PipelineRuntimePatch(BaseModel):
    cors_origins: list[str] | None = None
    scope_hosts: list[str] | None = None
    normalizer_order: list[str] | None = None
    crawl_max_depth: int | None = Field(default=None, ge=1, le=20)
    crawl_max_pages: int | None = Field(default=None, ge=1, le=10000)
    crawl_timeout_seconds: float | None = Field(default=None, ge=1.0, le=300.0)
    crawl_user_agent: str | None = None


class UIPrefs(BaseModel):
    graph_layout: str = "cose"
    node_size: float = 18.0
    font_size: float = 10.0
    edge_opacity: float = 0.65
    edge_width: float = 1.5
    label_max_len: int = 40
    wheel_sensitivity: float = 0.25


class AuthRuntime(BaseModel):
    """When both username and password are set, they override env credentials for HTTP Basic."""

    username: str | None = None
    password: str | None = None


class RuntimePayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    pipeline: PipelineRuntimePatch = Field(default_factory=PipelineRuntimePatch)
    ui: UIPrefs = Field(default_factory=UIPrefs)
    auth: AuthRuntime = Field(default_factory=AuthRuntime)


def _config_dir(settings: Settings) -> Path:
    d = settings.database_path.parent / _RUNTIME_SUBDIR
    d.mkdir(parents=True, exist_ok=True)
    return d


def runtime_file_path(settings: Settings) -> Path:
    return _config_dir(settings) / "runtime.json"


def _read_file(path: Path) -> RuntimePayload:
    if not path.is_file():
        return RuntimePayload()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return RuntimePayload()
    try:
        return RuntimePayload.model_validate(raw)
    except Exception:
        return RuntimePayload()


def load_runtime_payload(settings: Settings) -> RuntimePayload:
    return _read_file(runtime_file_path(settings))


def save_runtime_payload(settings: Settings, payload: RuntimePayload) -> None:
    path = runtime_file_path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload.model_dump(), indent=2), encoding="utf-8")


def get_effective_auth_credentials(settings: Settings) -> tuple[str, str]:
    payload = load_runtime_payload(settings)
    u = (payload.auth.username or "").strip()
    p = payload.auth.password or ""
    if u and p:
        return u, p
    return settings.auth_username, settings.auth_password


def set_runtime_auth(settings: Settings, username: str, password: str) -> RuntimePayload:
    with _PATCH_LOCK:
        current = _read_file(runtime_file_path(settings))
        current = current.model_copy(update={"auth": AuthRuntime(username=username.strip(), password=password)})
        save_runtime_payload(settings, current)
        return current


def clear_runtime_auth(settings: Settings) -> RuntimePayload:
    with _PATCH_LOCK:
        current = _read_file(runtime_file_path(settings))
        current = current.model_copy(update={"auth": AuthRuntime()})
        save_runtime_payload(settings, current)
        return current


_RUNTIME_KEYS = set(PipelineRuntimePatch.model_fields.keys())


def get_effective_settings() -> Settings:
    base = Settings()
    payload = load_runtime_payload(base)
    patch = payload.pipeline.model_dump(exclude_none=True)
    updates = {k: v for k, v in patch.items() if k in _RUNTIME_KEYS}
    return base.model_copy(update=updates)


def patch_runtime(settings: Settings, body: dict[str, Any]) -> RuntimePayload:
    with _PATCH_LOCK:
        current = _read_file(runtime_file_path(settings))
        if body.get("pipeline"):
            delta = PipelineRuntimePatch.model_validate(body["pipeline"])
            current = current.model_copy(
                update={
                    "pipeline": current.pipeline.model_copy(
                        update=delta.model_dump(exclude_unset=True)
                    )
                }
            )
        if body.get("ui"):
            delta_ui = UIPrefs.model_validate(body["ui"])
            current = current.model_copy(
                update={"ui": current.ui.model_copy(update=delta_ui.model_dump(exclude_unset=True))}
            )
        save_runtime_payload(settings, current)
        return current


def settings_public_dict(s: Settings) -> dict[str, Any]:
    return {
        "database_path": str(s.database_path),
        "uploads_dir": str(s.uploads_dir),
        "exports_dir": str(s.exports_dir),
        "cors_origins": list(s.cors_origins),
        "scope_hosts": list(s.scope_hosts),
        "normalizer_order": list(s.normalizer_order),
        "crawl_max_depth": s.crawl_max_depth,
        "crawl_max_pages": s.crawl_max_pages,
        "crawl_timeout_seconds": s.crawl_timeout_seconds,
        "crawl_user_agent": s.crawl_user_agent,
    }


def runtime_public_dict(payload: RuntimePayload) -> dict[str, Any]:
    d = payload.model_dump()
    auth = d.get("auth") or {}
    if auth.get("password"):
        d = {
            **d,
            "auth": {**auth, "password": "[stored]"},
        }
    return d


def env_settings_public(env: Settings) -> dict[str, Any]:
    """All env-backed fields for the UI (password redacted)."""
    d = env.model_dump()
    d["database_path"] = str(env.database_path)
    d["uploads_dir"] = str(env.uploads_dir)
    d["exports_dir"] = str(env.exports_dir)
    d["auth_password"] = "[redacted]" if env.auth_password else ""
    return d
