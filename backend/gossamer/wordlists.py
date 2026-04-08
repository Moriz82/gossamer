"""Wordlist management — discover, organize, and serve wordlists for fuzzing."""
from __future__ import annotations

import json
import logging
import subprocess
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Common default locations for SecLists and other wordlist collections
_DEFAULT_SEARCH_DIRS = [
    Path("/usr/share/seclists"),
    Path("/usr/share/wordlists"),
    Path("/opt/seclists"),
    Path("/opt/SecLists"),
    Path("/usr/local/share/seclists"),
    Path("/usr/local/share/SecLists"),
    Path("/opt/homebrew/share/seclists"),
    Path.home() / "SecLists",
    Path.home() / "seclists",
    Path.home() / "wordlists",
    Path.home() / ".gossamer" / "wordlists",
]

_WORDLIST_EXTENSIONS = {".txt", ".lst", ".dic", ".wl"}


def _config_path() -> Path:
    p = Path.home() / ".gossamer" / "wordlists.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _load_config() -> dict[str, Any]:
    cp = _config_path()
    if cp.exists():
        try:
            return json.loads(cp.read_text())
        except json.JSONDecodeError:
            pass
    return {"custom_dirs": [], "favorites": []}


def _save_config(cfg: dict[str, Any]) -> None:
    _config_path().write_text(json.dumps(cfg, indent=2))


def get_search_dirs() -> list[str]:
    """Return all wordlist search directories (defaults + custom)."""
    cfg = _load_config()
    custom = [str(d) for d in cfg.get("custom_dirs", [])]
    defaults = [str(d) for d in _DEFAULT_SEARCH_DIRS]
    seen: set[str] = set()
    result: list[str] = []
    for d in custom + defaults:
        if d not in seen:
            seen.add(d)
            result.append(d)
    return result


def add_search_dir(path: str) -> dict[str, Any]:
    """Add a custom wordlist search directory."""
    p = Path(path).expanduser().resolve()
    if not p.is_dir():
        return {"ok": False, "error": f"Directory not found: {path}"}
    cfg = _load_config()
    dirs = cfg.get("custom_dirs", [])
    sp = str(p)
    if sp not in dirs:
        dirs.append(sp)
        cfg["custom_dirs"] = dirs
        _save_config(cfg)
    return {"ok": True, "dirs": get_search_dirs()}


def remove_search_dir(path: str) -> dict[str, Any]:
    """Remove a custom wordlist search directory."""
    cfg = _load_config()
    dirs = cfg.get("custom_dirs", [])
    cfg["custom_dirs"] = [d for d in dirs if d != path]
    _save_config(cfg)
    return {"ok": True, "dirs": get_search_dirs()}


def discover_wordlists(
    category: str | None = None,
    search: str | None = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    """Scan search directories for wordlist files."""
    results: list[dict[str, Any]] = []
    for dir_str in get_search_dirs():
        d = Path(dir_str)
        if not d.is_dir():
            continue
        for f in d.rglob("*"):
            if not f.is_file():
                continue
            if f.suffix.lower() not in _WORDLIST_EXTENSIONS:
                continue
            rel = str(f.relative_to(d))
            # Guess category from path
            parts = rel.lower().split("/")
            cat = _guess_category(parts)
            if category and cat != category:
                continue
            if search and search.lower() not in rel.lower():
                continue
            try:
                line_count = sum(1 for _ in f.open(encoding="utf-8", errors="ignore"))
            except Exception:
                line_count = 0
            results.append({
                "path": str(f),
                "name": f.name,
                "relative": rel,
                "directory": dir_str,
                "category": cat,
                "size_bytes": f.stat().st_size,
                "lines": line_count,
            })
            if len(results) >= limit:
                return results
    return results


def _guess_category(path_parts: list[str]) -> str:
    """Guess wordlist category from path components."""
    joined = "/".join(path_parts)
    if "discovery" in joined or "directory" in joined or "dir" in joined:
        return "discovery"
    if "password" in joined or "pass" in joined or "credential" in joined:
        return "passwords"
    if "fuzzing" in joined or "fuzz" in joined:
        return "fuzzing"
    if "subdomain" in joined or "dns" in joined:
        return "subdomains"
    if "user" in joined or "name" in joined:
        return "usernames"
    if "vulner" in joined or "exploit" in joined or "payload" in joined:
        return "payloads"
    return "other"


def install_seclists() -> dict[str, Any]:
    """Clone SecLists to ~/.gossamer/wordlists/SecLists."""
    dest = Path.home() / ".gossamer" / "wordlists" / "SecLists"
    if dest.exists():
        return {"ok": True, "path": str(dest), "message": "SecLists already installed"}
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        logger.info("Cloning SecLists to %s", dest)
        subprocess.run(
            ["git", "clone", "--depth=1",
             "https://github.com/danielmiessler/SecLists.git",
             str(dest)],
            check=True, capture_output=True, timeout=300,
        )
        return {"ok": True, "path": str(dest)}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "Clone timed out after 5 minutes"}
    except subprocess.CalledProcessError as e:
        return {"ok": False, "error": e.stderr.decode()[:500] if e.stderr else str(e)}
    except FileNotFoundError:
        return {"ok": False, "error": "git not found — install git first"}
