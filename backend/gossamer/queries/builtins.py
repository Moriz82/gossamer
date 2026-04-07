from __future__ import annotations

import json
import sqlite3
from typing import Any

from gossamer.queries.base import QueryProvider
from gossamer.queries.registry import register_query


def _rows(cur: sqlite3.Cursor) -> list[dict[str, Any]]:
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


class AllEndpointsQuery(QueryProvider):
    name = "all_endpoints"
    description = "All Endpoint nodes"

    def run(self, conn: sqlite3.Connection) -> list[dict[str, Any]]:
        cur = conn.execute(
            "SELECT id, kind, key, properties_json FROM nodes WHERE kind = 'Endpoint' ORDER BY key LIMIT 5000"
        )
        out = _rows(cur)
        for r in out:
            r["properties"] = json.loads(r.pop("properties_json"))
        return out


class PostEndpointsQuery(QueryProvider):
    name = "post_endpoints"
    description = "Endpoints with method POST"

    def run(self, conn: sqlite3.Connection) -> list[dict[str, Any]]:
        cur = conn.execute(
            """
            SELECT id, kind, key, properties_json FROM nodes
            WHERE kind = 'Endpoint' AND properties_json LIKE '%"method": "POST"%'
            ORDER BY key LIMIT 2000
            """
        )
        out = _rows(cur)
        for r in out:
            r["properties"] = json.loads(r.pop("properties_json"))
        return out


class HighStatusCodesQuery(QueryProvider):
    name = "interesting_status_codes"
    description = "Endpoints with status 401,403,500"

    def run(self, conn: sqlite3.Connection) -> list[dict[str, Any]]:
        cur = conn.execute(
            """
            SELECT id, kind, key, properties_json FROM nodes
            WHERE kind = 'Endpoint'
              AND (
                properties_json LIKE '%"status_code": 401%' OR
                properties_json LIKE '%"status_code": 403%' OR
                properties_json LIKE '%"status_code": 500%'
              )
            LIMIT 2000
            """
        )
        out = _rows(cur)
        for r in out:
            r["properties"] = json.loads(r.pop("properties_json"))
        return out


register_query(AllEndpointsQuery())
register_query(PostEndpointsQuery())
register_query(HighStatusCodesQuery())
