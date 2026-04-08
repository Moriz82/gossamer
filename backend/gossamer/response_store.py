"""Filesystem-based HTTP response storage, sharded by hash prefix."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _response_id(method: str, url: str, timestamp: str) -> str:
    raw = f"{method}|{url}|{timestamp}"
    return hashlib.sha256(raw.encode()).hexdigest()


def save_response(
    responses_dir: Path,
    url: str,
    method: str,
    status: int | None,
    req_headers: dict[str, str] | None = None,
    resp_headers: dict[str, str] | None = None,
    body: str | None = None,
) -> str:
    ts = datetime.now(timezone.utc).isoformat()
    rid = _response_id(method, url, ts)
    shard_dir = responses_dir / rid[:2]
    shard_dir.mkdir(parents=True, exist_ok=True)
    data = {
        "id": rid,
        "url": url,
        "method": method,
        "status": status,
        "timestamp": ts,
        "request_headers": req_headers or {},
        "response_headers": resp_headers or {},
        "body_size": len(body) if body else 0,
        "body": body,
    }
    path = shard_dir / f"{rid}.json"
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return rid


def get_response(responses_dir: Path, response_id: str) -> dict[str, Any] | None:
    shard = response_id[:2]
    path = responses_dir / shard / f"{response_id}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def list_responses(
    responses_dir: Path,
    limit: int = 50,
    offset: int = 0,
) -> list[dict[str, Any]]:
    if not responses_dir.exists():
        return []
    entries: list[dict[str, Any]] = []
    for shard_dir in sorted(responses_dir.iterdir()):
        if not shard_dir.is_dir() or len(shard_dir.name) != 2:
            continue
        for f in shard_dir.glob("*.json"):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                entries.append({
                    "id": data["id"], "url": data["url"], "method": data["method"],
                    "status": data.get("status"), "timestamp": data.get("timestamp", ""),
                    "body_size": data.get("body_size", 0),
                })
            except (json.JSONDecodeError, KeyError):
                continue
    entries.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
    return entries[offset : offset + limit]


def search_responses(
    responses_dir: Path,
    url_pattern: str,
    limit: int = 50,
) -> list[dict[str, Any]]:
    if not responses_dir.exists():
        return []
    pattern_lower = url_pattern.lower()
    matches: list[dict[str, Any]] = []
    for shard_dir in sorted(responses_dir.iterdir()):
        if not shard_dir.is_dir() or len(shard_dir.name) != 2:
            continue
        for f in shard_dir.glob("*.json"):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                if pattern_lower in data.get("url", "").lower():
                    matches.append({
                        "id": data["id"], "url": data["url"], "method": data["method"],
                        "status": data.get("status"), "timestamp": data.get("timestamp", ""),
                        "body_size": data.get("body_size", 0),
                    })
                    if len(matches) >= limit:
                        return matches
            except (json.JSONDecodeError, KeyError):
                continue
    return matches
