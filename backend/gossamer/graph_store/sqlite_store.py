from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from gossamer.graph_store.base import GraphStore
from gossamer.graph_types.registry import EDGE_TYPE_DEFS, NODE_TYPE_DEFS
from gossamer.models import NormalizedEdge, NormalizedNode


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class SqliteGraphStore(GraphStore):
    def __init__(self, path: Path) -> None:
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA foreign_keys = ON")
        self.init_schema()

    def init_schema(self) -> None:
        self._conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS nodes (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                key TEXT NOT NULL,
                properties_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT,
                updated_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_nodes_kind ON nodes(kind);
            CREATE INDEX IF NOT EXISTS idx_nodes_key ON nodes(key);

            CREATE TABLE IF NOT EXISTS edges (
                id TEXT PRIMARY KEY,
                src_id TEXT NOT NULL,
                dst_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                properties_json TEXT NOT NULL DEFAULT '{}',
                sources_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT,
                updated_at TEXT,
                FOREIGN KEY (src_id) REFERENCES nodes(id),
                FOREIGN KEY (dst_id) REFERENCES nodes(id)
            );
            CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src_id);
            CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst_id);
            CREATE INDEX IF NOT EXISTS idx_edges_kind ON edges(kind);
            """
        )
        self._conn.commit()

    def upsert_node(self, node: NormalizedNode, merge_properties: dict[str, Any]) -> None:
        typ = NODE_TYPE_DEFS.get(node.kind)
        merge_fn = typ.merge_properties if typ else lambda a, b: {**a, **b}
        cur = self._conn.execute("SELECT properties_json FROM nodes WHERE id = ?", (node.id,))
        row = cur.fetchone()
        now = _utc_now()
        if row is None:
            props = merge_fn({}, {**node.properties, **merge_properties})
            self._conn.execute(
                """
                INSERT INTO nodes (id, kind, key, properties_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (node.id, node.kind, node.key, json.dumps(props), now, now),
            )
        else:
            existing = json.loads(row["properties_json"])
            props = merge_fn(existing, {**node.properties, **merge_properties})
            self._conn.execute(
                """
                UPDATE nodes SET properties_json = ?, updated_at = ?, key = ?
                WHERE id = ?
                """,
                (json.dumps(props), now, node.key, node.id),
            )
        self._conn.commit()

    def upsert_edge(self, edge: NormalizedEdge, merge_properties: dict[str, Any]) -> None:
        typ = EDGE_TYPE_DEFS.get(edge.kind)
        merge_props = typ.merge_properties if typ else lambda a, b: {**a, **b}
        merge_src = typ.merge_sources if typ else lambda a, b: sorted(set(a) | {b})
        cur = self._conn.execute("SELECT properties_json, sources_json FROM edges WHERE id = ?", (edge.id,))
        row = cur.fetchone()
        now = _utc_now()
        if row is None:
            props = merge_props({}, {**edge.properties, **merge_properties})
            sources = merge_src([], edge.source)
            self._conn.execute(
                """
                INSERT INTO edges (id, src_id, dst_id, kind, properties_json, sources_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    edge.id,
                    edge.src_id,
                    edge.dst_id,
                    edge.kind,
                    json.dumps(props),
                    json.dumps(sources),
                    now,
                    now,
                ),
            )
        else:
            props = merge_props(json.loads(row["properties_json"]), {**edge.properties, **merge_properties})
            sources = merge_src(json.loads(row["sources_json"]), edge.source)
            self._conn.execute(
                """
                UPDATE edges SET properties_json = ?, sources_json = ?, updated_at = ?
                WHERE id = ?
                """,
                (json.dumps(props), json.dumps(sources), now, edge.id),
            )
        self._conn.commit()

    def get_graph_snapshot(self) -> dict[str, Any]:
        nodes = [
            {
                "id": r["id"],
                "kind": r["kind"],
                "key": r["key"],
                "properties": json.loads(r["properties_json"]),
            }
            for r in self._conn.execute("SELECT id, kind, key, properties_json FROM nodes")
        ]
        edges = [
            {
                "id": r["id"],
                "kind": r["kind"],
                "source": r["src_id"],
                "target": r["dst_id"],
                "properties": json.loads(r["properties_json"]),
                "sources": json.loads(r["sources_json"]),
            }
            for r in self._conn.execute(
                "SELECT id, kind, src_id, dst_id, properties_json, sources_json FROM edges"
            )
        ]
        return {"nodes": nodes, "edges": edges}

    def clear(self) -> None:
        self._conn.execute("DELETE FROM edges")
        self._conn.execute("DELETE FROM nodes")
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()
