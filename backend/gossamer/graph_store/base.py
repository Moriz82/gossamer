from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from gossamer.models import NormalizedEdge, NormalizedNode


class GraphStore(ABC):
    @abstractmethod
    def init_schema(self) -> None: ...

    @abstractmethod
    def upsert_node(self, node: NormalizedNode, merge_properties: dict[str, Any]) -> None: ...

    @abstractmethod
    def upsert_edge(self, edge: NormalizedEdge, merge_properties: dict[str, Any]) -> None: ...

    @abstractmethod
    def get_graph_snapshot(self) -> dict[str, Any]: ...

    @abstractmethod
    def clear(self) -> None: ...

    def close(self) -> None:
        pass

    def supports_sql_queries(self) -> bool:
        return False

    def health_descriptor(self) -> str:
        return "graph"

    def as_sqlite_connection(self) -> Any | None:
        return None

    def get_neighbors(self, node_id: str, direction: str = "both") -> dict[str, Any]:
        raise NotImplementedError

    def supports_path_queries(self) -> bool:
        return False

    def list_findings(self, limit: int = 2000) -> list[dict[str, Any]]:
        nodes = self.get_graph_snapshot()["nodes"]
        return [n for n in nodes if n.get("kind") == "Finding"][:limit]
