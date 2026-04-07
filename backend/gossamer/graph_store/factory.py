from __future__ import annotations

from gossamer.config import Settings
from gossamer.graph_store.base import GraphStore
from gossamer.graph_store.sqlite_store import SqliteGraphStore


def create_graph_store(settings: Settings) -> GraphStore:
    if settings.neo4j_uri.strip():
        from gossamer.graph_store.neo4j_store import Neo4jGraphStore

        return Neo4jGraphStore(settings)
    return SqliteGraphStore(settings.database_path)
