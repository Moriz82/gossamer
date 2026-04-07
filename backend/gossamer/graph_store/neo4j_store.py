from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from neo4j import Driver, GraphDatabase

from gossamer.config import Settings
from gossamer.graph_store.base import GraphStore
from gossamer.graph_types.registry import EDGE_TYPE_DEFS, NODE_TYPE_DEFS
from gossamer.models import NormalizedEdge, NormalizedNode

_EDGE_TO_CYPHER = {
    "serves": "SERVES",
    "discovered_by": "DISCOVERED_BY",
    "links_to": "LINKS_TO",
    "redirects_to": "REDIRECTS_TO",
    "contains_form": "CONTAINS_FORM",
    "submits_to": "SUBMITS_TO",
    "found_on": "FOUND_ON",
}

_ALLOWED_REL_TYPES = list(_EDGE_TO_CYPHER.values())


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Neo4jGraphStore(GraphStore):
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._database = settings.neo4j_database
        self._driver: Driver = GraphDatabase.driver(
            settings.neo4j_uri,
            auth=(settings.neo4j_user, settings.neo4j_password),
        )
        self.init_schema()

    def fetch_all(self, cypher: str, **params: Any) -> list[Any]:
        with self._driver.session(database=self._database) as session:
            return list(session.run(cypher, **params))

    def init_schema(self) -> None:
        stmts = [
            "CREATE CONSTRAINT gossamer_host_id IF NOT EXISTS FOR (n:Host) REQUIRE n.id IS UNIQUE",
            "CREATE CONSTRAINT gossamer_endpoint_id IF NOT EXISTS FOR (n:Endpoint) REQUIRE n.id IS UNIQUE",
            "CREATE CONSTRAINT gossamer_source_id IF NOT EXISTS FOR (n:Source) REQUIRE n.id IS UNIQUE",
            "CREATE CONSTRAINT gossamer_form_id IF NOT EXISTS FOR (n:Form) REQUIRE n.id IS UNIQUE",
            "CREATE CONSTRAINT gossamer_finding_id IF NOT EXISTS FOR (n:Finding) REQUIRE n.id IS UNIQUE",
        ]
        with self._driver.session(database=self._database) as session:
            for s in stmts:
                session.run(s)

    def supports_sql_queries(self) -> bool:
        return False

    def health_descriptor(self) -> str:
        return f"neo4j:{self._settings.neo4j_uri}"

    def upsert_node(self, node: NormalizedNode, merge_properties: dict[str, Any]) -> None:
        typ = NODE_TYPE_DEFS.get(node.kind)
        merge_fn = typ.merge_properties if typ else lambda a, b: {**a, **b}
        label = node.kind
        now = _utc_now()
        with self._driver.session(database=self._database) as session:
            rec = session.run(
                f"MATCH (n:`{label}` {{id: $id}}) RETURN n.properties_json AS pj, n.created_at AS ca",
                id=node.id,
            ).single()
            if rec is None or rec["pj"] is None:
                props = merge_fn({}, {**node.properties, **merge_properties})
                session.run(
                    f"""
                    CREATE (n:`{label}`)
                    SET n.id = $id, n.kind = $kind, n.key = $key,
                        n.properties_json = $pj, n.created_at = $now, n.updated_at = $now
                    """,
                    id=node.id,
                    kind=node.kind,
                    key=node.key,
                    pj=json.dumps(props),
                    now=now,
                )
            else:
                existing = json.loads(rec["pj"])
                props = merge_fn(existing, {**node.properties, **merge_properties})
                ca = rec["ca"] or now
                session.run(
                    f"""
                    MATCH (n:`{label}` {{id: $id}})
                    SET n.key = $key, n.properties_json = $pj, n.updated_at = $now,
                        n.created_at = coalesce(n.created_at, $ca)
                    """,
                    id=node.id,
                    key=node.key,
                    pj=json.dumps(props),
                    now=now,
                    ca=ca,
                )

    def upsert_edge(self, edge: NormalizedEdge, merge_properties: dict[str, Any]) -> None:
        rtype = _EDGE_TO_CYPHER.get(edge.kind)
        if not rtype:
            return
        typ = EDGE_TYPE_DEFS.get(edge.kind)
        merge_props = typ.merge_properties if typ else lambda a, b: {**a, **b}
        merge_src = typ.merge_sources if typ else lambda a, b: sorted(set(a) | {b})
        now = _utc_now()
        with self._driver.session(database=self._database) as session:
            rec = session.run(
                f"""
                MATCH (src {{id: $sid}})-[r:`{rtype}` {{gid: $gid}}]->(dst {{id: $did}})
                RETURN r.properties_json AS pj, r.sources_json AS sj, r.created_at AS ca
                """,
                sid=edge.src_id,
                did=edge.dst_id,
                gid=edge.id,
            ).single()
            if rec is None:
                props = merge_props({}, {**edge.properties, **merge_properties})
                sources = merge_src([], edge.source)
                session.run(
                    f"""
                    MATCH (src {{id: $sid}}), (dst {{id: $did}})
                    CREATE (src)-[r:`{rtype}`]->(dst)
                    SET r.gid = $gid,
                        r.edge_kind = $ekind,
                        r.properties_json = $pj,
                        r.sources_json = $sj,
                        r.created_at = $now,
                        r.updated_at = $now
                    """,
                    sid=edge.src_id,
                    did=edge.dst_id,
                    gid=edge.id,
                    ekind=edge.kind,
                    pj=json.dumps(props),
                    sj=json.dumps(sources),
                    now=now,
                )
            else:
                props = merge_props(
                    json.loads(rec["pj"]) if rec["pj"] else {},
                    {**edge.properties, **merge_properties},
                )
                sources = merge_src(
                    json.loads(rec["sj"]) if rec["sj"] else [],
                    edge.source,
                )
                ca = rec["ca"] or now
                session.run(
                    f"""
                    MATCH (src {{id: $sid}})-[r:`{rtype}` {{gid: $gid}}]->(dst {{id: $did}})
                    SET r.properties_json = $pj, r.sources_json = $sj, r.updated_at = $now,
                        r.created_at = coalesce(r.created_at, $ca)
                    """,
                    sid=edge.src_id,
                    did=edge.dst_id,
                    gid=edge.id,
                    pj=json.dumps(props),
                    sj=json.dumps(sources),
                    now=now,
                    ca=ca,
                )

    def get_graph_snapshot(self) -> dict[str, Any]:
        nl = self._settings.graph_snapshot_max_nodes
        el = self._settings.graph_snapshot_max_edges
        nodes: list[dict[str, Any]] = []
        edges: list[dict[str, Any]] = []
        with self._driver.session(database=self._database) as session:
            for row in session.run(
                """
                MATCH (n)
                RETURN n.id AS id, n.kind AS kind, n.key AS key, n.properties_json AS pj
                LIMIT $lim
                """,
                lim=nl,
            ):
                pj = row["pj"] or "{}"
                nodes.append(
                    {
                        "id": row["id"],
                        "kind": row["kind"],
                        "key": row["key"],
                        "properties": json.loads(pj),
                    }
                )
            for row in session.run(
                """
                MATCH (a)-[r]->(b)
                WHERE type(r) IN $rtypes
                RETURN r.gid AS id, r.edge_kind AS kind, a.id AS src_id, b.id AS dst_id,
                       r.properties_json AS pj, r.sources_json AS sj
                LIMIT $lim
                """,
                lim=el,
                rtypes=_ALLOWED_REL_TYPES,
            ):
                pj = row["pj"] or "{}"
                sj = row["sj"] or "[]"
                edges.append(
                    {
                        "id": row["id"],
                        "kind": row["kind"],
                        "source": row["src_id"],
                        "target": row["dst_id"],
                        "properties": json.loads(pj),
                        "sources": json.loads(sj),
                    }
                )
        return {"nodes": nodes, "edges": edges}

    def get_graph_stats(self) -> dict[str, Any]:
        node_counts: dict[str, int] = {}
        edge_counts: dict[str, int] = {}
        with self._driver.session(database=self._database) as session:
            for row in session.run(
                "MATCH (n) RETURN n.kind AS kind, count(*) AS c"
            ):
                kind = row["kind"] or "Unknown"
                node_counts[kind] = row["c"]
            for row in session.run(
                "MATCH ()-[r]->() WHERE type(r) IN $rtypes "
                "RETURN coalesce(r.edge_kind, toLower(type(r))) AS kind, count(*) AS c",
                rtypes=_ALLOWED_REL_TYPES,
            ):
                kind = row["kind"] or "unknown"
                edge_counts[kind] = row["c"]
        return {
            "node_counts": node_counts,
            "edge_counts": edge_counts,
            "total_nodes": sum(node_counts.values()),
            "total_edges": sum(edge_counts.values()),
        }

    def get_filtered_snapshot(
        self,
        include_kinds: list[str] | None = None,
        exclude_kinds: list[str] | None = None,
        limit: int = 5000,
    ) -> dict[str, Any]:
        lim = max(1, min(int(limit), 50_000))
        nodes: list[dict[str, Any]] = []
        edges: list[dict[str, Any]] = []

        # Build node filter clause
        where_parts: list[str] = []
        params: dict[str, Any] = {"lim": lim, "rtypes": _ALLOWED_REL_TYPES}
        if include_kinds:
            where_parts.append("n.kind IN $kinds")
            params["kinds"] = include_kinds
        if exclude_kinds:
            where_parts.append("NOT n.kind IN $exclude")
            params["exclude"] = exclude_kinds
        node_where = f" WHERE {' AND '.join(where_parts)}" if where_parts else ""

        with self._driver.session(database=self._database) as session:
            for row in session.run(
                f"MATCH (n){node_where} "
                "RETURN n.id AS id, n.kind AS kind, n.key AS key, n.properties_json AS pj "
                "LIMIT $lim",
                **params,
            ):
                pj = row["pj"] or "{}"
                nodes.append(
                    {
                        "id": row["id"],
                        "kind": row["kind"],
                        "key": row["key"],
                        "properties": json.loads(pj),
                    }
                )
            # Only fetch edges between filtered nodes
            node_ids = [n["id"] for n in nodes]
            if node_ids:
                for row in session.run(
                    "MATCH (a)-[r]->(b) "
                    "WHERE type(r) IN $rtypes AND a.id IN $nids AND b.id IN $nids "
                    "RETURN r.gid AS id, r.edge_kind AS kind, a.id AS src_id, b.id AS dst_id, "
                    "       r.properties_json AS pj, r.sources_json AS sj",
                    rtypes=_ALLOWED_REL_TYPES,
                    nids=node_ids,
                ):
                    pj = row["pj"] or "{}"
                    sj = row["sj"] or "[]"
                    edges.append(
                        {
                            "id": row["id"],
                            "kind": row["kind"],
                            "source": row["src_id"],
                            "target": row["dst_id"],
                            "properties": json.loads(pj),
                            "sources": json.loads(sj),
                        }
                    )
        return {"nodes": nodes, "edges": edges}

    def clear(self) -> None:
        with self._driver.session(database=self._database) as session:
            session.run("MATCH (n) DETACH DELETE n")

    def list_findings(self, limit: int = 2000) -> list[dict[str, Any]]:
        lim = max(1, min(int(limit), 50_000))
        rows = self.fetch_all(
            """
            MATCH (f:Finding)
            RETURN f.id AS id, f.kind AS kind, f.key AS key, f.properties_json AS pj
            ORDER BY f.updated_at DESC, f.id
            LIMIT $lim
            """,
            lim=lim,
        )
        return [
            {
                "id": r["id"],
                "kind": r["kind"],
                "key": r["key"],
                "properties": json.loads(r["pj"] or "{}"),
            }
            for r in rows
        ]

    def close(self) -> None:
        self._driver.close()

    def get_neighbors(self, node_id: str, direction: str = "both") -> dict[str, Any]:
        """direction: in, out, both"""
        out: dict[str, list[dict[str, Any]]] = {"inbound_groups": [], "outbound_groups": []}
        with self._driver.session(database=self._database) as session:
            if direction in ("out", "both"):
                rows = session.run(
                    """
                    MATCH (n {id: $id})-[r]->(m)
                    RETURN coalesce(r.edge_kind, toLower(type(r))) AS rt,
                           m.id AS mid, m.kind AS mk, m.key AS mk2, m.properties_json AS pj
                    ORDER BY rt, mid
                    """,
                    id=node_id,
                )
                groups: dict[str, list[dict[str, Any]]] = {}
                for row in rows:
                    rt = row["rt"]
                    groups.setdefault(rt, []).append(
                        {
                            "id": row["mid"],
                            "kind": row["mk"],
                            "key": row["mk2"],
                            "properties": json.loads(row["pj"] or "{}"),
                        }
                    )
                out["outbound_groups"] = [{"rel_type": k, "nodes": v} for k, v in sorted(groups.items())]
            if direction in ("in", "both"):
                rows = session.run(
                    """
                    MATCH (m)-[r]->(n {id: $id})
                    RETURN coalesce(r.edge_kind, toLower(type(r))) AS rt,
                           m.id AS mid, m.kind AS mk, m.key AS mk2, m.properties_json AS pj
                    ORDER BY rt, mid
                    """,
                    id=node_id,
                )
                groups = {}
                for row in rows:
                    rt = row["rt"]
                    groups.setdefault(rt, []).append(
                        {
                            "id": row["mid"],
                            "kind": row["mk"],
                            "key": row["mk2"],
                            "properties": json.loads(row["pj"] or "{}"),
                        }
                    )
                out["inbound_groups"] = [{"rel_type": k, "nodes": v} for k, v in sorted(groups.items())]
        return out

    def shortest_path(self, from_id: str, to_id: str, max_hops: int | None = None) -> dict[str, Any] | None:
        mh = max_hops if max_hops is not None else self._settings.graph_path_max_hops
        types = "|".join(_ALLOWED_REL_TYPES)
        cypher = f"""
            MATCH (a {{id: $from_id}}), (b {{id: $to_id}})
            MATCH p = shortestPath((a)-[:{types}*1..{mh}]-(b))
            RETURN p AS p
            LIMIT 1
            """
        with self._driver.session(database=self._database) as session:
            rec = session.run(cypher, from_id=from_id, to_id=to_id).single()
            if not rec or rec["p"] is None:
                return None
            path = rec["p"]
            node_ids = [n["id"] for n in path.nodes]
            edge_steps: list[dict[str, Any]] = []
            rels = list(path.relationships)
            for i, rel in enumerate(rels):
                raw_pj = rel.get("properties_json")
                if isinstance(raw_pj, str):
                    props = json.loads(raw_pj or "{}")
                else:
                    props = {}
                edge_steps.append(
                    {
                        "id": rel.get("gid"),
                        "kind": rel.get("edge_kind"),
                        "neo4j_type": rel.type,
                        "source": node_ids[i],
                        "target": node_ids[i + 1],
                        "properties": props,
                    }
                )
            return {"nodes": [{"id": nid} for nid in node_ids], "edges": edge_steps}

    def supports_path_queries(self) -> bool:
        return True

    def export_graph_dict(self) -> dict[str, Any]:
        """Full export (unlimited) for backup zip."""
        with self._driver.session(database=self._database) as session:
            nodes = []
            for row in session.run(
                "MATCH (n) RETURN n.id AS id, n.kind AS kind, n.key AS key, n.properties_json AS pj, labels(n) AS labels"
            ):
                nodes.append(
                    {
                        "id": row["id"],
                        "kind": row["kind"],
                        "key": row["key"],
                        "properties": json.loads(row["pj"] or "{}"),
                        "labels": row["labels"],
                    }
                )
            edges = []
            for row in session.run(
                """
                MATCH (a)-[r]->(b)
                RETURN r.gid AS id, r.edge_kind AS kind, a.id AS sid, b.id AS did,
                       type(r) AS ntype, r.properties_json AS pj, r.sources_json AS sj
                """
            ):
                edges.append(
                    {
                        "id": row["id"],
                        "kind": row["kind"],
                        "source": row["sid"],
                        "target": row["did"],
                        "neo4j_rel_type": row["ntype"],
                        "properties": json.loads(row["pj"] or "{}"),
                        "sources": json.loads(row["sj"] or "[]"),
                    }
                )
        return {"version": 1, "format": "gossamer-neo4j-json", "nodes": nodes, "edges": edges}

    def import_graph_dict(self, payload: dict[str, Any]) -> None:
        nodes = payload.get("nodes") or []
        edges = payload.get("edges") or []
        with self._driver.session(database=self._database) as session:
            session.run("MATCH (n) DETACH DELETE n")
        for n in nodes:
            kind = n.get("kind") or "Entity"
            label = kind
            with self._driver.session(database=self._database) as session:
                session.run(
                    f"""
                    CREATE (x:`{label}`)
                    SET x.id = $id, x.kind = $kind, x.key = $key,
                        x.properties_json = $pj, x.created_at = $ts, x.updated_at = $ts
                    """,
                    id=n["id"],
                    kind=kind,
                    key=n.get("key", ""),
                    pj=json.dumps(n.get("properties") or {}),
                    ts=_utc_now(),
                )
        for e in edges:
            rtype = _EDGE_TO_CYPHER.get(e.get("kind") or "")
            if not rtype:
                continue
            with self._driver.session(database=self._database) as session:
                session.run(
                    f"""
                    MATCH (a {{id: $sid}}), (b {{id: $did}})
                    CREATE (a)-[r:`{rtype}`]->(b)
                    SET r.gid = $gid, r.edge_kind = $ek, r.properties_json = $pj, r.sources_json = $sj,
                        r.created_at = $ts, r.updated_at = $ts
                    """,
                    sid=e["source"],
                    did=e["target"],
                    gid=e["id"],
                    ek=e.get("kind"),
                    pj=json.dumps(e.get("properties") or {}),
                    sj=json.dumps(e.get("sources") or []),
                    ts=_utc_now(),
                )
