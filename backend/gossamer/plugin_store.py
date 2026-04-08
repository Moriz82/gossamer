"""Modular plugin store for managing external scanner tools."""
from __future__ import annotations

import json
import logging
import platform
import shutil
import subprocess
import tarfile
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger(__name__)


@dataclass
class PluginManifest:
    id: str
    type: str  # "scanner", "ingestor", "template_pack"
    name: str
    description: str
    version: str  # latest known version
    source_repo: str  # GitHub "owner/repo"
    binary_name: str  # e.g. "nuclei"
    install_method: str  # "github_release"
    platforms: dict[str, str]  # {"darwin_arm64": "nuclei_3.3.7_macOS_arm64.zip", ...}
    ingestor: str = ""  # which ingestor handles output
    default_args: list[str] = field(default_factory=list)
    updatable: bool = True
    category: str = ""


def _registry_path() -> Path:
    return Path(__file__).parent / "plugins" / "registry.json"


def _plugin_dir() -> Path:
    d = Path.home() / ".gossamer" / "plugins"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _platform_key() -> str:
    system = platform.system().lower()  # darwin, linux, windows
    machine = platform.machine().lower()
    if machine in ("x86_64", "amd64"):
        machine = "amd64"
    elif machine in ("arm64", "aarch64"):
        machine = "arm64"
    return f"{system}_{machine}"


def _load_registry() -> list[PluginManifest]:
    path = _registry_path()
    if not path.exists():
        return []
    data = json.loads(path.read_text())
    return [PluginManifest(**p) for p in data.get("plugins", [])]


def _installed_version(plugin_id: str) -> str | None:
    meta = _plugin_dir() / plugin_id / "meta.json"
    if meta.exists():
        return json.loads(meta.read_text()).get("version")
    return None


def _find_binary(plugin: PluginManifest) -> str | None:
    plugin_bin = _plugin_dir() / plugin.id / plugin.binary_name
    if plugin_bin.exists():
        return str(plugin_bin)
    return shutil.which(plugin.binary_name)


def list_plugins() -> list[dict[str, Any]]:
    """List all known plugins with their install status."""
    registry = _load_registry()
    result = []
    for p in registry:
        installed_ver = _installed_version(p.id)
        binary_path = _find_binary(p)
        result.append({
            "id": p.id,
            "type": p.type,
            "name": p.name,
            "description": p.description,
            "latest_version": p.version,
            "installed_version": installed_ver,
            "installed": installed_ver is not None or binary_path is not None,
            "binary_found": binary_path is not None,
            "binary_path": binary_path,
            "source_repo": p.source_repo,
            "updatable": p.updatable,
            "category": p.category,
            "update_available": (
                installed_ver is not None and installed_ver != p.version
            ),
        })
    return result


def check_status(plugin_id: str) -> dict[str, Any]:
    """Detailed status for one plugin."""
    registry = _load_registry()
    plugin = next((p for p in registry if p.id == plugin_id), None)
    if not plugin:
        return {"error": f"Unknown plugin: {plugin_id}"}
    installed_ver = _installed_version(plugin_id)
    binary_path = _find_binary(plugin)
    binary_version = None
    if binary_path:
        try:
            result = subprocess.run(
                [binary_path, "--version"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            binary_version = (
                result.stdout.strip()[:100] or result.stderr.strip()[:100]
            )
        except Exception:
            pass
    return {
        "id": plugin.id,
        "name": plugin.name,
        "type": plugin.type,
        "latest_version": plugin.version,
        "installed_version": installed_ver,
        "binary_path": binary_path,
        "binary_version": binary_version,
        "binary_found": binary_path is not None,
        "update_available": (
            installed_ver is not None and installed_ver != plugin.version
        ),
    }


def install_plugin(plugin_id: str) -> dict[str, Any]:
    """Download and install a plugin from GitHub releases."""
    registry = _load_registry()
    plugin = next((p for p in registry if p.id == plugin_id), None)
    if not plugin:
        return {"ok": False, "error": f"Unknown plugin: {plugin_id}"}

    pk = _platform_key()
    asset_name = plugin.platforms.get(pk)
    if not asset_name:
        return {"ok": False, "error": f"No binary available for platform {pk}"}

    download_url = (
        f"https://github.com/{plugin.source_repo}"
        f"/releases/latest/download/{asset_name}"
    )
    dest_dir = _plugin_dir() / plugin.id
    dest_dir.mkdir(parents=True, exist_ok=True)

    try:
        logger.info("Downloading %s from %s", plugin_id, download_url)
        with httpx.Client(follow_redirects=True, timeout=120) as client:
            resp = client.get(download_url)
            resp.raise_for_status()

        archive_path = dest_dir / asset_name
        archive_path.write_bytes(resp.content)

        if asset_name.endswith(".zip"):
            with zipfile.ZipFile(archive_path) as zf:
                zf.extractall(dest_dir)
        elif asset_name.endswith((".tar.gz", ".tgz")):
            with tarfile.open(archive_path) as tf:
                tf.extractall(dest_dir)

        archive_path.unlink(missing_ok=True)

        binary = dest_dir / plugin.binary_name
        if binary.exists():
            binary.chmod(0o755)

        meta = {"version": plugin.version, "plugin_id": plugin_id}
        (dest_dir / "meta.json").write_text(json.dumps(meta))

        return {"ok": True, "version": plugin.version, "path": str(binary), "plugins": list_plugins()}
    except Exception as e:
        logger.error("Failed to install %s: %s", plugin_id, e)
        return {"ok": False, "error": str(e), "plugins": list_plugins()}


def update_plugin(plugin_id: str) -> dict[str, Any]:
    """Update plugin to latest version (reinstall)."""
    return install_plugin(plugin_id)


def uninstall_plugin(plugin_id: str) -> dict[str, Any]:
    """Remove installed plugin."""
    dest_dir = _plugin_dir() / plugin_id
    if dest_dir.exists():
        shutil.rmtree(dest_dir)
        return {"ok": True, "plugins": list_plugins()}
    return {"ok": False, "error": "Plugin not installed", "plugins": list_plugins()}


def check_all_updates() -> list[dict[str, Any]]:
    """Check GitHub for latest versions of all plugins. Returns update status for each."""
    import time
    cache_path = _plugin_dir() / "update_cache.json"

    # Check cache (24h TTL)
    if cache_path.exists():
        try:
            cache = json.loads(cache_path.read_text())
            if time.time() - cache.get("timestamp", 0) < 86400:
                return cache.get("results", [])
        except (json.JSONDecodeError, KeyError):
            pass

    registry = _load_registry()
    results = []
    for p in registry:
        installed_ver = _installed_version(p.id)
        latest_ver = p.version  # fallback to registry version
        try:
            with httpx.Client(follow_redirects=True, timeout=10) as client:
                resp = client.get(f"https://api.github.com/repos/{p.source_repo}/releases/latest")
                if resp.status_code == 200:
                    data = resp.json()
                    tag = data.get("tag_name", "")
                    # Strip leading 'v' from tag
                    latest_ver = tag.lstrip("v") if tag else p.version
        except Exception:
            pass

        results.append({
            "id": p.id,
            "name": p.name,
            "installed_version": installed_ver,
            "latest_version": latest_ver,
            "registry_version": p.version,
            "update_available": installed_ver is not None and installed_ver != latest_ver,
        })

    # Cache results
    cache = {"timestamp": time.time(), "results": results}
    try:
        cache_path.write_text(json.dumps(cache, indent=2))
    except Exception:
        pass

    return results


def update_all() -> list[dict[str, Any]]:
    """Update all plugins that have updates available."""
    updates = check_all_updates()
    results = []
    for u in updates:
        if u["update_available"]:
            result = install_plugin(u["id"])
            results.append({"id": u["id"], **result})
    return results


def get_binary_path(plugin_id: str) -> str | None:
    """Get path to plugin binary, checking plugin dir then PATH."""
    registry = _load_registry()
    plugin = next((p for p in registry if p.id == plugin_id), None)
    if not plugin:
        return None
    return _find_binary(plugin)
