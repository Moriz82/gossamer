from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class QueryProvider(ABC):
    name: str
    description: str

    @abstractmethod
    def run(self, conn: Any) -> list[dict[str, Any]]:
        """Execute against sqlite3 connection; return row dicts."""
        ...
