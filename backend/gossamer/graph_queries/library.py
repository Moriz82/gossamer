"""Pre-built graph queries returning subgraph snapshots {nodes, edges}."""
from __future__ import annotations

import json
from typing import Any


class GraphQuery:
    name: str = ""
    description: str = ""
    category: str = ""

    def run(self, store: Any) -> dict[str, Any]:
        raise NotImplementedError


def _nodes_from_rows(rows: list[Any]) -> list[dict[str, Any]]:
    return [
        {"id": r["id"], "kind": r["kind"], "key": r["key"],
         "properties": json.loads(r["properties_json"])}
        for r in rows
    ]


def _edges_for_node_ids(conn: Any, node_ids: set[str]) -> list[dict[str, Any]]:
    if not node_ids:
        return []
    placeholders = ",".join("?" for _ in node_ids)
    sql = (
        f"SELECT id, kind, src_id, dst_id, properties_json, sources_json FROM edges "
        f"WHERE src_id IN ({placeholders}) AND dst_id IN ({placeholders})"
    )
    params = list(node_ids) + list(node_ids)
    return [
        {"id": r["id"], "kind": r["kind"], "source": r["src_id"], "target": r["dst_id"],
         "properties": json.loads(r["properties_json"]),
         "sources": json.loads(r["sources_json"])}
        for r in conn.execute(sql, params)
    ]


def _run_sql_snapshot(store: Any, node_sql: str, params: list[Any] | None = None) -> dict[str, Any]:
    conn = store.as_sqlite_connection()
    if conn is None:
        raise RuntimeError("Graph queries require the SQLite backend.")
    rows = conn.execute(node_sql, params or []).fetchall()
    nodes = _nodes_from_rows(rows)
    node_ids = {n["id"] for n in nodes}
    edges = _edges_for_node_ids(conn, node_ids)
    return {"nodes": nodes, "edges": edges}


# --- Discovery queries ---

class AllHosts(GraphQuery):
    name = "all_hosts"
    description = "All discovered hosts"
    category = "Discovery"
    def run(self, store: Any) -> dict[str, Any]:
        return _run_sql_snapshot(store, "SELECT id, kind, key, properties_json FROM nodes WHERE kind='Host'")

class AllEndpointsByHost(GraphQuery):
    name = "all_endpoints"
    description = "All endpoints grouped by host"
    category = "Discovery"
    def run(self, store: Any) -> dict[str, Any]:
        return _run_sql_snapshot(store,
            "SELECT id, kind, key, properties_json FROM nodes WHERE kind IN ('Host','Endpoint')")

class ExternalHosts(GraphQuery):
    name = "external_hosts"
    description = "Hosts discovered via links but not directly crawled"
    category = "Discovery"
    def run(self, store: Any) -> dict[str, Any]:
        conn = store.as_sqlite_connection()
        if conn is None:
            raise RuntimeError("Graph queries require the SQLite backend.")
        sql = """
            SELECT n.id, n.kind, n.key, n.properties_json FROM nodes n
            WHERE n.kind='Host'
            AND n.id NOT IN (
                SELECT DISTINCT e.src_id FROM edges e WHERE e.kind='serves'
                AND e.dst_id IN (
                    SELECT n2.id FROM nodes n2 WHERE n2.kind='Endpoint'
                    AND json_extract(n2.properties_json, '$.status_code') IS NOT NULL
                )
            )
        """
        rows = conn.execute(sql).fetchall()
        nodes = _nodes_from_rows(rows)
        node_ids = {n["id"] for n in nodes}
        edges = _edges_for_node_ids(conn, node_ids)
        return {"nodes": nodes, "edges": edges}

class FormsWithPost(GraphQuery):
    name = "forms_post"
    description = "Forms using POST method"
    category = "Discovery"
    def run(self, store: Any) -> dict[str, Any]:
        return _run_sql_snapshot(store,
            "SELECT id, kind, key, properties_json FROM nodes WHERE kind='Form' AND json_extract(properties_json, '$.method')='POST'")

# --- Findings queries ---

class AllFindings(GraphQuery):
    name = "all_findings"
    description = "All findings (excluding fingerprinting noise)"
    category = "Findings"
    def run(self, store: Any) -> dict[str, Any]:
        conn = store.as_sqlite_connection()
        if conn is None:
            raise RuntimeError("Graph queries require the SQLite backend.")
        # Exclude low-severity fingerprinting findings from graph
        finding_rows = conn.execute(
            "SELECT id, kind, key, properties_json FROM nodes WHERE kind='Finding' "
            "AND json_extract(properties_json, '$.template_id') NOT IN "
            "('missing_security_headers','server_version_disclosure','insecure_cookie')"
        ).fetchall()
        finding_nodes = _nodes_from_rows(finding_rows)
        finding_ids = {n["id"] for n in finding_nodes}
        endpoint_ids: set[str] = set()
        if finding_ids:
            ph = ",".join("?" for _ in finding_ids)
            for r in conn.execute(
                f"SELECT dst_id FROM edges WHERE kind='found_on' AND src_id IN ({ph})",
                list(finding_ids)
            ):
                endpoint_ids.add(r["dst_id"])
        ep_rows = []
        if endpoint_ids:
            ph2 = ",".join("?" for _ in endpoint_ids)
            ep_rows = conn.execute(
                f"SELECT id, kind, key, properties_json FROM nodes WHERE id IN ({ph2})",
                list(endpoint_ids)
            ).fetchall()
        ep_nodes = _nodes_from_rows(ep_rows)
        all_ids = finding_ids | endpoint_ids
        edges = _edges_for_node_ids(conn, all_ids)
        return {"nodes": finding_nodes + ep_nodes, "edges": edges}

class CriticalHighFindings(GraphQuery):
    name = "critical_high_findings"
    description = "Critical and high severity findings"
    category = "Findings"
    def run(self, store: Any) -> dict[str, Any]:
        return _run_sql_snapshot(store,
            "SELECT id, kind, key, properties_json FROM nodes WHERE kind='Finding' "
            "AND json_extract(properties_json, '$.severity') IN ('critical','high')")

class FindingsByScanner(GraphQuery):
    name = "findings_by_scanner"
    description = "All findings grouped by scanner source"
    category = "Findings"
    def run(self, store: Any) -> dict[str, Any]:
        return _run_sql_snapshot(store,
            "SELECT id, kind, key, properties_json FROM nodes WHERE kind='Finding' ORDER BY json_extract(properties_json, '$.scanner')")

class EndpointsWithFindings(GraphQuery):
    name = "endpoints_with_findings"
    description = "Endpoints that have associated findings"
    category = "Findings"
    def run(self, store: Any) -> dict[str, Any]:
        conn = store.as_sqlite_connection()
        if conn is None:
            raise RuntimeError("Graph queries require the SQLite backend.")
        sql = """
            SELECT DISTINCT n.id, n.kind, n.key, n.properties_json FROM nodes n
            JOIN edges e ON (e.dst_id = n.id AND e.kind='found_on')
            WHERE n.kind='Endpoint'
        """
        ep_rows = conn.execute(sql).fetchall()
        ep_nodes = _nodes_from_rows(ep_rows)
        ep_ids = {n["id"] for n in ep_nodes}
        # Also get the findings
        finding_ids: set[str] = set()
        if ep_ids:
            ph = ",".join("?" for _ in ep_ids)
            for r in conn.execute(
                f"SELECT src_id FROM edges WHERE kind='found_on' AND dst_id IN ({ph})",
                list(ep_ids)
            ):
                finding_ids.add(r["src_id"])
        f_rows = []
        if finding_ids:
            ph2 = ",".join("?" for _ in finding_ids)
            f_rows = conn.execute(
                f"SELECT id, kind, key, properties_json FROM nodes WHERE id IN ({ph2})",
                list(finding_ids)
            ).fetchall()
        f_nodes = _nodes_from_rows(f_rows)
        all_ids = ep_ids | finding_ids
        edges = _edges_for_node_ids(conn, all_ids)
        return {"nodes": ep_nodes + f_nodes, "edges": edges}

# --- Relationships queries ---

class RedirectChains(GraphQuery):
    name = "redirect_chains"
    description = "All redirect chains between endpoints"
    category = "Relationships"
    def run(self, store: Any) -> dict[str, Any]:
        conn = store.as_sqlite_connection()
        if conn is None:
            raise RuntimeError("Graph queries require the SQLite backend.")
        edge_rows = conn.execute(
            "SELECT id, kind, src_id, dst_id, properties_json, sources_json FROM edges WHERE kind='redirects_to'"
        ).fetchall()
        node_ids: set[str] = set()
        edges = []
        for r in edge_rows:
            node_ids.add(r["src_id"])
            node_ids.add(r["dst_id"])
            edges.append({"id": r["id"], "kind": r["kind"], "source": r["src_id"], "target": r["dst_id"],
                          "properties": json.loads(r["properties_json"]), "sources": json.loads(r["sources_json"])})
        nodes = []
        if node_ids:
            ph = ",".join("?" for _ in node_ids)
            rows = conn.execute(f"SELECT id, kind, key, properties_json FROM nodes WHERE id IN ({ph})", list(node_ids)).fetchall()
            nodes = _nodes_from_rows(rows)
        return {"nodes": nodes, "edges": edges}

class HostEndpointFindingPaths(GraphQuery):
    name = "host_endpoint_finding_paths"
    description = "Host \u2192 Endpoint \u2192 Finding paths (excluding noise)"
    category = "Relationships"
    def run(self, store: Any) -> dict[str, Any]:
        conn = store.as_sqlite_connection()
        if conn is None:
            raise RuntimeError("Graph queries require the SQLite backend.")
        # Get all hosts and endpoints
        he_rows = conn.execute(
            "SELECT id, kind, key, properties_json FROM nodes WHERE kind IN ('Host','Endpoint')"
        ).fetchall()
        # Get non-fingerprinting findings only
        f_rows = conn.execute(
            "SELECT id, kind, key, properties_json FROM nodes WHERE kind='Finding' "
            "AND json_extract(properties_json, '$.template_id') NOT IN "
            "('missing_security_headers','server_version_disclosure','insecure_cookie')"
        ).fetchall()
        nodes = _nodes_from_rows(he_rows) + _nodes_from_rows(f_rows)
        node_ids = {n["id"] for n in nodes}
        edges = _edges_for_node_ids(conn, node_ids)
        return {"nodes": nodes, "edges": edges}

# --- Attack Surface queries ---

class MissingSecurityHeaders(GraphQuery):
    name = "missing_security_headers"
    description = "Findings for missing security headers"
    category = "Attack Surface"
    def run(self, store: Any) -> dict[str, Any]:
        return _run_sql_snapshot(store,
            "SELECT id, kind, key, properties_json FROM nodes WHERE kind='Finding' "
            "AND json_extract(properties_json, '$.template_id')='missing_security_headers'")

class SensitivePaths(GraphQuery):
    name = "sensitive_paths"
    description = "Findings for accessible sensitive paths"
    category = "Attack Surface"
    def run(self, store: Any) -> dict[str, Any]:
        return _run_sql_snapshot(store,
            "SELECT id, kind, key, properties_json FROM nodes WHERE kind='Finding' "
            "AND json_extract(properties_json, '$.template_id')='sensitive_path'")

class LoginForms(GraphQuery):
    name = "login_forms"
    description = "Forms likely to be login pages (password input fields)"
    category = "Attack Surface"
    def run(self, store: Any) -> dict[str, Any]:
        return _run_sql_snapshot(store,
            "SELECT id, kind, key, properties_json FROM nodes WHERE kind='Form' "
            "AND json_extract(properties_json, '$.input_fields') LIKE '%password%'")

class FileUploadForms(GraphQuery):
    name = "file_upload_forms"
    description = "Forms with file upload inputs"
    category = "Attack Surface"
    def run(self, store: Any) -> dict[str, Any]:
        return _run_sql_snapshot(store,
            "SELECT id, kind, key, properties_json FROM nodes WHERE kind='Form' "
            "AND json_extract(properties_json, '$.input_fields') LIKE '%file%'")

class ApiEndpoints(GraphQuery):
    name = "api_endpoints"
    description = "Endpoints with JSON or API content types"
    category = "Attack Surface"
    def run(self, store: Any) -> dict[str, Any]:
        return _run_sql_snapshot(store,
            "SELECT id, kind, key, properties_json FROM nodes WHERE kind='Endpoint' "
            "AND (json_extract(properties_json, '$.content_type') LIKE '%json%' "
            "OR json_extract(properties_json, '$.url') LIKE '%/api/%')")

class AdminPaths(GraphQuery):
    name = "admin_paths"
    description = "Endpoints with admin-related paths"
    category = "Attack Surface"
    def run(self, store: Any) -> dict[str, Any]:
        return _run_sql_snapshot(store,
            "SELECT id, kind, key, properties_json FROM nodes WHERE kind='Endpoint' "
            "AND (json_extract(properties_json, '$.url') LIKE '%/admin%' "
            "OR json_extract(properties_json, '$.url') LIKE '%/manage%' "
            "OR json_extract(properties_json, '$.url') LIKE '%/dashboard%')")

class ServerErrors(GraphQuery):
    name = "server_errors"
    description = "Endpoints returning 5xx status codes"
    category = "Analysis"
    def run(self, store: Any) -> dict[str, Any]:
        return _run_sql_snapshot(store,
            "SELECT id, kind, key, properties_json FROM nodes WHERE kind='Endpoint' "
            "AND CAST(json_extract(properties_json, '$.status_code') AS INTEGER) >= 500")

class CorsWildcard(GraphQuery):
    name = "cors_wildcard"
    description = "CORS wildcard findings"
    category = "Attack Surface"
    def run(self, store: Any) -> dict[str, Any]:
        return _run_sql_snapshot(store,
            "SELECT id, kind, key, properties_json FROM nodes WHERE kind='Finding' "
            "AND json_extract(properties_json, '$.template_id')='cors_wildcard'")


# --- Registry ---

_ALL_QUERIES: list[GraphQuery] = [
    AllHosts(), AllEndpointsByHost(), ExternalHosts(), FormsWithPost(),
    AllFindings(), CriticalHighFindings(), FindingsByScanner(), EndpointsWithFindings(),
    RedirectChains(), HostEndpointFindingPaths(),
    MissingSecurityHeaders(), SensitivePaths(), LoginForms(), FileUploadForms(),
    ApiEndpoints(), AdminPaths(), ServerErrors(), CorsWildcard(),
]

_QUERY_MAP: dict[str, GraphQuery] = {q.name: q for q in _ALL_QUERIES}


def list_graph_queries() -> list[dict[str, str]]:
    return [{"name": q.name, "description": q.description, "category": q.category} for q in _ALL_QUERIES]


def get_graph_query(name: str) -> GraphQuery | None:
    return _QUERY_MAP.get(name)
