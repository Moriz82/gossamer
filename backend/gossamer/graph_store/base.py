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
