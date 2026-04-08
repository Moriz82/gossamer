"""Visual query builder — converts form input to parameterized SQL."""
from __future__ import annotations

import json
import re
from typing import Any

# Whitelists for safety
_ALLOWED_NODE_KINDS = {"Host", "Endpoint", "Form", "Finding", "Source"}
_ALLOWED_EDGE_KINDS = {"serves", "discovered_by", "links_to", "redirects_to", "contains_form", "submits_to", "found_on"}
_ALLOWED_OPERATORS = {"equals", "contains", "starts_with", "gt", "lt", "is_null", "is_not_null"}
_SAFE_SQL = re.compile(r"^\s*select\s", re.I | re.S)


def build_query(spec: dict[str, Any]) -> tuple[str, list[Any]]:
    """Convert a visual builder spec to (sql, params).

    spec = {
        "node_kind": "Endpoint",
        "filters": [{"property": "status_code", "operator": "equals", "value": "200"}],
        "relationships": [{"edge_kind": "serves", "direction": "in"}]
    }
    """
    node_kind = spec.get("node_kind", "")
    if node_kind not in _ALLOWED_NODE_KINDS:
        raise ValueError(f"Invalid node kind: {node_kind}")

    filters = spec.get("filters", [])
    relationships = spec.get("relationships", [])
    params: list[Any] = []

    clauses = ["n.kind = ?"]
    params.append(node_kind)

    for f in filters:
        prop = str(f.get("property", ""))
        op = str(f.get("operator", ""))
        val = f.get("value", "")

        if op not in _ALLOWED_OPERATORS:
            raise ValueError(f"Invalid operator: {op}")
        if not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", prop):
            raise ValueError(f"Invalid property name: {prop}")

        json_path = f"json_extract(n.properties_json, '$.{prop}')"

        if op == "equals":
            clauses.append(f"{json_path} = ?")
            params.append(val)
        elif op == "contains":
            clauses.append(f"{json_path} LIKE ?")
            params.append(f"%{val}%")
        elif op == "starts_with":
            clauses.append(f"{json_path} LIKE ?")
            params.append(f"{val}%")
        elif op == "gt":
            clauses.append(f"CAST({json_path} AS REAL) > ?")
            params.append(float(val))
        elif op == "lt":
            clauses.append(f"CAST({json_path} AS REAL) < ?")
            params.append(float(val))
        elif op == "is_null":
            clauses.append(f"{json_path} IS NULL")
        elif op == "is_not_null":
            clauses.append(f"{json_path} IS NOT NULL")

    where = " AND ".join(clauses)
    sql = f"SELECT n.id, n.kind, n.key, n.properties_json FROM nodes n WHERE {where}"

    # Add relationship joins
    for i, rel in enumerate(relationships):
        edge_kind = str(rel.get("edge_kind", ""))
        direction = str(rel.get("direction", "out"))
        if edge_kind not in _ALLOWED_EDGE_KINDS:
            raise ValueError(f"Invalid edge kind: {edge_kind}")
        alias = f"e{i}"
        if direction == "in":
            sql = f"SELECT n.id, n.kind, n.key, n.properties_json FROM nodes n JOIN edges {alias} ON {alias}.dst_id = n.id AND {alias}.kind = ? WHERE {where}"
        else:
            sql = f"SELECT n.id, n.kind, n.key, n.properties_json FROM nodes n JOIN edges {alias} ON {alias}.src_id = n.id AND {alias}.kind = ? WHERE {where}"
        params.insert(0, edge_kind)

    return sql, params


def run_visual_query(store: Any, spec: dict[str, Any]) -> dict[str, Any]:
    """Execute a visual builder query and return a subgraph snapshot."""
    sql, params = build_query(spec)
    conn = store.as_sqlite_connection()
    if conn is None:
        raise RuntimeError("Visual query builder requires the SQLite backend.")
    rows = conn.execute(sql, params).fetchall()
    nodes = [
        {"id": r["id"], "kind": r["kind"], "key": r["key"],
         "properties": json.loads(r["properties_json"])}
        for r in rows
    ]
    node_ids = {n["id"] for n in nodes}
    # Get edges between result nodes
    edges = []
    if node_ids:
        ph = ",".join("?" for _ in node_ids)
        edge_sql = (
            f"SELECT id, kind, src_id, dst_id, properties_json, sources_json FROM edges "
            f"WHERE src_id IN ({ph}) AND dst_id IN ({ph})"
        )
        edge_params = list(node_ids) + list(node_ids)
        for r in conn.execute(edge_sql, edge_params):
            edges.append({
                "id": r["id"], "kind": r["kind"], "source": r["src_id"], "target": r["dst_id"],
                "properties": json.loads(r["properties_json"]),
                "sources": json.loads(r["sources_json"]),
            })
    return {"nodes": nodes, "edges": edges}


def run_raw_sql(store: Any, sql: str) -> dict[str, Any]:
    """Execute raw SQL (SELECT only, no semicolons) and return subgraph snapshot."""
    s = sql.strip()
    if not _SAFE_SQL.match(s):
        raise ValueError("Only SELECT statements are allowed")
    if ";" in s:
        raise ValueError("Multiple statements not allowed")
    conn = store.as_sqlite_connection()
    if conn is None:
        raise RuntimeError("Raw SQL requires the SQLite backend.")
    rows = conn.execute(s).fetchall()
    # Try to interpret results as a node snapshot
    nodes = []
    for r in rows:
        row_dict = dict(r)
        if "id" in row_dict and "kind" in row_dict:
            props = {}
            if "properties_json" in row_dict:
                props = json.loads(row_dict["properties_json"])
            nodes.append({
                "id": row_dict["id"], "kind": row_dict["kind"],
                "key": row_dict.get("key", ""), "properties": props,
            })
    node_ids = {n["id"] for n in nodes}
    edges = []
    if node_ids:
        ph = ",".join("?" for _ in node_ids)
        edge_sql = (
            f"SELECT id, kind, src_id, dst_id, properties_json, sources_json FROM edges "
            f"WHERE src_id IN ({ph}) AND dst_id IN ({ph})"
        )
        edge_params = list(node_ids) + list(node_ids)
        for r in conn.execute(edge_sql, edge_params):
            edges.append({
                "id": r["id"], "kind": r["kind"], "source": r["src_id"], "target": r["dst_id"],
                "properties": json.loads(r["properties_json"]),
                "sources": json.loads(r["sources_json"]),
            })
    return {"nodes": nodes, "edges": edges}
