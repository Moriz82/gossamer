from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from gossamer.queries.base import QueryProvider

_REGISTRY: dict[str, "QueryProvider"] = {}


def register_query(q: "QueryProvider") -> None:
    _REGISTRY[q.name] = q


def get_query(name: str) -> "QueryProvider | None":
    return _REGISTRY.get(name)


def all_queries() -> list["QueryProvider"]:
    return list(_REGISTRY.values())
