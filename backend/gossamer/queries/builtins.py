from __future__ import annotations

import json
import sqlite3
from typing import Any

from gossamer.graph_store.base import GraphStore
from gossamer.graph_store.neo4j_store import Neo4jGraphStore
from gossamer.graph_store.sqlite_store import SqliteGraphStore
from gossamer.queries.base import QueryProvider
from gossamer.queries.registry import register_query


def _rows_sqlite(cur: sqlite3.Cursor) -> list[dict[str, Any]]:
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def _endpoint_rows_neo4j(
    store: Neo4jGraphStore,
    where_clause: str = "",
    *,
    limit: int | None = None,
    **params: Any,
) -> list[dict[str, Any]]:
    lim = f"LIMIT {int(limit)}" if limit is not None else ""
    q = f"""
        MATCH (n:Endpoint)
        {where_clause}
        RETURN n.id AS id, n.kind AS kind, n.key AS key, n.properties_json AS pj
        ORDER BY n.key
        {lim}
        """
    rows: list[dict[str, Any]] = []
    for rec in store.fetch_all(q, **params):
        rows.append(
            {
                "id": rec["id"],
                "kind": rec["kind"],
                "key": rec["key"],
                "properties": json.loads(rec["pj"] or "{}"),
            }
        )
    return rows


class AllEndpointsQuery(QueryProvider):
    name = "all_endpoints"
    description = "All Endpoint nodes"

    def run(self, store: GraphStore) -> list[dict[str, Any]]:
        if isinstance(store, SqliteGraphStore):
            cur = store._conn.execute(
                "SELECT id, kind, key, properties_json FROM nodes WHERE kind = 'Endpoint' ORDER BY key LIMIT 5000"
            )
            out = _rows_sqlite(cur)
            for r in out:
                r["properties"] = json.loads(r.pop("properties_json"))
            return out
        if isinstance(store, Neo4jGraphStore):
            return _endpoint_rows_neo4j(store, limit=5000)
        raise TypeError(f"Unsupported graph store: {type(store)}")


class PostEndpointsQuery(QueryProvider):
    name = "post_endpoints"
    description = "Endpoints with method POST"

    def run(self, store: GraphStore) -> list[dict[str, Any]]:
        if isinstance(store, SqliteGraphStore):
            cur = store._conn.execute(
                """
                SELECT id, kind, key, properties_json FROM nodes
                WHERE kind = 'Endpoint' AND properties_json LIKE '%"method": "POST"%'
                ORDER BY key LIMIT 2000
                """
            )
            out = _rows_sqlite(cur)
            for r in out:
                r["properties"] = json.loads(r.pop("properties_json"))
            return out
        if isinstance(store, Neo4jGraphStore):
            return _endpoint_rows_neo4j(
                store,
                """
                WHERE n.properties_json CONTAINS '"method": "POST"'
                """,
                limit=2000,
            )
        raise TypeError(f"Unsupported graph store: {type(store)}")


class HighStatusCodesQuery(QueryProvider):
    name = "interesting_status_codes"
    description = "Endpoints with status 401,403,500"

    def run(self, store: GraphStore) -> list[dict[str, Any]]:
        if isinstance(store, SqliteGraphStore):
            cur = store._conn.execute(
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
            out = _rows_sqlite(cur)
            for r in out:
                r["properties"] = json.loads(r.pop("properties_json"))
            return out
        if isinstance(store, Neo4jGraphStore):
            wc = """
                WHERE n.properties_json CONTAINS '"status_code": 401'
                   OR n.properties_json CONTAINS '"status_code": 403'
                   OR n.properties_json CONTAINS '"status_code": 500'
                """
            return _endpoint_rows_neo4j(store, wc, limit=2000)
        raise TypeError(f"Unsupported graph store: {type(store)}")


register_query(AllEndpointsQuery())
register_query(PostEndpointsQuery())
register_query(HighStatusCodesQuery())
