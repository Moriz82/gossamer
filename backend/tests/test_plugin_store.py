"""Tests for the plugin store module."""
from __future__ import annotations

import json
import zipfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from gossamer.plugin_store import (
    _installed_version,
    _load_registry,
    _platform_key,
    check_status,
    get_binary_path,
    install_plugin,
    list_plugins,
    uninstall_plugin,
)


@pytest.fixture()
def fake_plugin_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Redirect plugin dir to a temp directory for isolation."""
    plugin_dir = tmp_path / "plugins"
    plugin_dir.mkdir()
    monkeypatch.setattr("gossamer.plugin_store._plugin_dir", lambda: plugin_dir)
    return plugin_dir


# ── Registry loading ──────────────────────────────────────────


def test_load_registry_returns_manifests() -> None:
    """Registry JSON loads into PluginManifest dataclasses."""
    plugins = _load_registry()
    assert len(plugins) >= 6
    ids = {p.id for p in plugins}
    assert "nuclei" in ids
    assert "trivy" in ids
    assert "semgrep" in ids


def test_load_registry_fields() -> None:
    """Spot-check a known plugin's fields."""
    plugins = _load_registry()
    nuclei = next(p for p in plugins if p.id == "nuclei")
    assert nuclei.binary_name == "nuclei"
    assert nuclei.source_repo == "projectdiscovery/nuclei"
    assert "darwin_arm64" in nuclei.platforms


# ── Platform key ──────────────────────────────────────────────


def test_platform_key_format() -> None:
    """Platform key is system_machine, e.g. 'darwin_arm64'."""
    key = _platform_key()
    parts = key.split("_")
    assert len(parts) == 2
    assert parts[0] in ("darwin", "linux", "windows")
    assert parts[1] in ("amd64", "arm64", "i386", "i686", "ppc64le", "s390x")


# ── list_plugins ──────────────────────────────────────────────


def test_list_plugins_returns_all(fake_plugin_dir: Path) -> None:
    """list_plugins returns an entry per registry plugin with status fields."""
    result = list_plugins()
    assert len(result) >= 6
    for entry in result:
        assert "id" in entry
        assert "installed" in entry
        assert "latest_version" in entry
        assert "update_available" in entry


def test_list_plugins_detects_installed(fake_plugin_dir: Path) -> None:
    """Plugins with meta.json are reported as installed."""
    pdir = fake_plugin_dir / "nuclei"
    pdir.mkdir()
    (pdir / "meta.json").write_text(json.dumps({"version": "3.3.7"}))
    result = list_plugins()
    nuclei = next(e for e in result if e["id"] == "nuclei")
    assert nuclei["installed"] is True
    assert nuclei["installed_version"] == "3.3.7"
    assert nuclei["update_available"] is False


def test_list_plugins_detects_update(fake_plugin_dir: Path) -> None:
    """Old installed version triggers update_available flag."""
    pdir = fake_plugin_dir / "nuclei"
    pdir.mkdir()
    (pdir / "meta.json").write_text(json.dumps({"version": "3.0.0"}))
    result = list_plugins()
    nuclei = next(e for e in result if e["id"] == "nuclei")
    assert nuclei["update_available"] is True


# ── check_status ──────────────────────────────────────────────


def test_check_status_known_plugin(fake_plugin_dir: Path) -> None:
    """check_status returns details for a known plugin."""
    result = check_status("nuclei")
    assert result["id"] == "nuclei"
    assert result["name"] == "Nuclei"
    assert "latest_version" in result


def test_check_status_unknown_plugin() -> None:
    """Unknown plugin ID returns an error dict."""
    result = check_status("nonexistent_scanner")
    assert "error" in result


# ── install_plugin (mocked download) ─────────────────────────


def test_install_plugin_unknown() -> None:
    """Install of unknown plugin returns error."""
    result = install_plugin("bogus_tool")
    assert result["ok"] is False
    assert "Unknown plugin" in result["error"]


def test_install_plugin_downloads_and_extracts(
    fake_plugin_dir: Path, tmp_path: Path
) -> None:
    """Install downloads a zip, extracts binary, writes meta.json."""
    # Build a tiny zip containing a fake binary
    zip_buf = tmp_path / "fake.zip"
    with zipfile.ZipFile(zip_buf, "w") as zf:
        zf.writestr("nuclei", "#!/bin/sh\necho fake")

    mock_resp = MagicMock()
    mock_resp.content = zip_buf.read_bytes()
    mock_resp.raise_for_status = MagicMock()

    mock_client = MagicMock()
    mock_client.get.return_value = mock_resp
    mock_client.__enter__ = MagicMock(return_value=mock_client)
    mock_client.__exit__ = MagicMock(return_value=False)

    with patch("gossamer.plugin_store._platform_key", return_value="darwin_arm64"), \
         patch("gossamer.plugin_store.httpx.Client", return_value=mock_client):
        result = install_plugin("nuclei")

    assert result["ok"] is True
    assert result["version"] == "3.3.7"
    assert (fake_plugin_dir / "nuclei" / "nuclei").exists()
    meta = json.loads((fake_plugin_dir / "nuclei" / "meta.json").read_text())
    assert meta["version"] == "3.3.7"


def test_install_plugin_no_platform(fake_plugin_dir: Path) -> None:
    """Install fails cleanly when no asset exists for the current platform."""
    with patch("gossamer.plugin_store._platform_key", return_value="freebsd_mips"):
        result = install_plugin("nuclei")
    assert result["ok"] is False
    assert "No binary available" in result["error"]


# ── uninstall_plugin ──────────────────────────────────────────


def test_uninstall_plugin_removes_dir(fake_plugin_dir: Path) -> None:
    """Uninstall removes the plugin directory."""
    pdir = fake_plugin_dir / "nuclei"
    pdir.mkdir()
    (pdir / "meta.json").write_text("{}")
    result = uninstall_plugin("nuclei")
    assert result["ok"] is True
    assert not pdir.exists()


def test_uninstall_plugin_not_installed(fake_plugin_dir: Path) -> None:
    """Uninstall of not-installed plugin returns error."""
    result = uninstall_plugin("nuclei")
    assert result["ok"] is False


# ── get_binary_path ───────────────────────────────────────────


def test_get_binary_path_unknown() -> None:
    """Unknown plugin returns None."""
    assert get_binary_path("nonexistent") is None


def test_get_binary_path_finds_in_plugin_dir(fake_plugin_dir: Path) -> None:
    """Binary in plugin dir is found."""
    pdir = fake_plugin_dir / "nuclei"
    pdir.mkdir()
    binary = pdir / "nuclei"
    binary.write_text("#!/bin/sh\necho v3.3.7")
    binary.chmod(0o755)
    path = get_binary_path("nuclei")
    assert path is not None
    assert path.endswith("nuclei")


def test_get_binary_path_falls_back_to_system(fake_plugin_dir: Path) -> None:
    """Falls back to shutil.which when not in plugin dir."""
    with patch("gossamer.plugin_store.shutil.which", return_value="/usr/bin/nuclei"):
        path = get_binary_path("nuclei")
    assert path == "/usr/bin/nuclei"


# ── _installed_version ────────────────────────────────────────


def test_installed_version_missing(fake_plugin_dir: Path) -> None:
    """Returns None when no meta.json exists."""
    assert _installed_version("nuclei") is None


def test_installed_version_present(fake_plugin_dir: Path) -> None:
    """Returns version from meta.json."""
    pdir = fake_plugin_dir / "nuclei"
    pdir.mkdir()
    (pdir / "meta.json").write_text(json.dumps({"version": "3.3.7"}))
    assert _installed_version("nuclei") == "3.3.7"
