from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import yaml

from gossamer.queries.base import QueryProvider
from gossamer.queries.registry import register_query

_SAFE_SQL = re.compile(r"^\s*select\s", re.I | re.S)


def _rows(cur: Any) -> list[dict[str, Any]]:
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def load_yaml_queries(directory: Path) -> int:
    """Load custom YAML query definitions from directory. Returns count loaded."""
    if not directory.is_dir():
        return 0
    count = 0
    for p in sorted(directory.glob("*.yaml")):
        data = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
        name = data.get("name")
        sql = data.get("sql")
        description = data.get("description") or f"Custom query from {p.name}"
        if not name or not sql or not isinstance(sql, str):
            continue
        s = sql.strip()
        if not _SAFE_SQL.match(s) or ";" in s:
            continue

        class YamlQuery(QueryProvider):
            pass

        nm = str(name)
        desc = str(description)
        stmt = sql.strip().rstrip(";")

        class _Yq(YamlQuery):
            name = nm
            description = desc

            def run(self, store: Any) -> list[dict[str, Any]]:
                conn = store.as_sqlite_connection()
                if conn is None:
                    raise RuntimeError("Custom YAML queries require the SQLite graph backend.")
                cur = conn.execute(stmt)
                out = _rows(cur)
                for r in out:
                    if "properties_json" in r and isinstance(r["properties_json"], str):
                        r["properties"] = json.loads(r["properties_json"])
                        del r["properties_json"]
                return out

        register_query(_Yq())
        count += 1
    return count
