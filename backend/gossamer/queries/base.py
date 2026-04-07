from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from gossamer.graph_store.base import GraphStore


class QueryProvider(ABC):
    name: str
    description: str

    @abstractmethod
    def run(self, store: GraphStore) -> list[dict[str, Any]]:
        """Execute against the active graph store backend."""
        ...
