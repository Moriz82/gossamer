"""Local SQLite cache for CVE lookup results.

Stores CVE data fetched from online APIs so repeated lookups are instant.
TTL-based expiry ensures data stays reasonably fresh.
"""
from __future__ import annotations

import json
import logging
import sqlite3
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_DB_PATH = Path.home() / ".gossamer" / "cve_cache.db"
_TTL_SECONDS = 86400  # 24 hours


@dataclass
class CVEEntry:
    cve_id: str
    severity: str = "unknown"
    cvss_score: float | None = None
    description: str = ""
    references: list[str] = field(default_factory=list)
    exploit_available: bool = False
    affected_products: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "cve_id": self.cve_id,
            "severity": self.severity,
            "cvss_score": self.cvss_score,
            "description": self.description,
            "references": self.references,
            "exploit_available": self.exploit_available,
            "affected_products": self.affected_products,
        }


def _get_conn() -> sqlite3.Connection:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_DB_PATH))
    conn.execute("""CREATE TABLE IF NOT EXISTS cve_lookups (
        tech_name TEXT NOT NULL,
        version TEXT NOT NULL DEFAULT '',
        last_checked REAL NOT NULL,
        results_json TEXT NOT NULL,
        PRIMARY KEY (tech_name, version)
    )""")
    conn.execute("""CREATE TABLE IF NOT EXISTS cve_entries (
        cve_id TEXT PRIMARY KEY,
        severity TEXT,
        cvss_score REAL,
        description TEXT,
        references_json TEXT,
        exploit_available INTEGER DEFAULT 0,
        affected_products_json TEXT
    )""")
    conn.commit()
    return conn


def get_cached(tech_name: str, version: str = "") -> list[CVEEntry] | None:
    """Return cached CVE results if fresh, or None if stale/missing."""
    try:
        conn = _get_conn()
        row = conn.execute(
            "SELECT last_checked, results_json FROM cve_lookups WHERE tech_name=? AND version=?",
            (tech_name.lower(), version),
        ).fetchone()
        if row and (time.time() - row[0]) < _TTL_SECONDS:
            return [CVEEntry(**e) for e in json.loads(row[1])]
    except Exception as e:
        logger.debug("CVE cache read error: %s", e)
    return None


def store_cached(tech_name: str, version: str, entries: list[CVEEntry]) -> None:
    """Store CVE lookup results in cache."""
    try:
        conn = _get_conn()
        results_json = json.dumps([e.to_dict() for e in entries])
        conn.execute(
            "INSERT OR REPLACE INTO cve_lookups (tech_name, version, last_checked, results_json) VALUES (?,?,?,?)",
            (tech_name.lower(), version, time.time(), results_json),
        )
        for e in entries:
            conn.execute(
                "INSERT OR REPLACE INTO cve_entries (cve_id, severity, cvss_score, description, references_json, exploit_available, affected_products_json) VALUES (?,?,?,?,?,?,?)",
                (e.cve_id, e.severity, e.cvss_score, e.description,
                 json.dumps(e.references), 1 if e.exploit_available else 0,
                 json.dumps(e.affected_products)),
            )
        conn.commit()
    except Exception as e:
        logger.debug("CVE cache write error: %s", e)


def get_cve_detail(cve_id: str) -> CVEEntry | None:
    """Get a single CVE from cache by ID."""
    try:
        conn = _get_conn()
        row = conn.execute(
            "SELECT severity, cvss_score, description, references_json, exploit_available, affected_products_json FROM cve_entries WHERE cve_id=?",
            (cve_id,),
        ).fetchone()
        if row:
            return CVEEntry(
                cve_id=cve_id, severity=row[0], cvss_score=row[1],
                description=row[2], references=json.loads(row[3] or "[]"),
                exploit_available=bool(row[4]),
                affected_products=json.loads(row[5] or "[]"),
            )
    except Exception:
        pass
    return None


def cache_stats() -> dict[str, int]:
    """Return cache statistics."""
    try:
        conn = _get_conn()
        lookups = conn.execute("SELECT COUNT(*) FROM cve_lookups").fetchone()[0]
        entries = conn.execute("SELECT COUNT(*) FROM cve_entries").fetchone()[0]
        fresh = conn.execute(
            "SELECT COUNT(*) FROM cve_lookups WHERE (? - last_checked) < ?",
            (time.time(), _TTL_SECONDS),
        ).fetchone()[0]
        return {"lookups": lookups, "entries": entries, "fresh": fresh}
    except Exception:
        return {"lookups": 0, "entries": 0, "fresh": 0}
