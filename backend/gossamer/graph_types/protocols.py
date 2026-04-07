from __future__ import annotations

from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class NodeTypeDef(Protocol):
    kind: str

    def stable_id(self, key: str) -> str:
        """Opaque stable node id from merge key."""
        ...

    def merge_properties(self, existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
        ...

    def ui_hints(self) -> dict[str, Any]:
        """Labels, colors, searchable fields for the front-end registry."""
        ...


@runtime_checkable
class EdgeTypeDef(Protocol):
    kind: str

    def stable_id(self, src_id: str, dst_id: str, properties: dict[str, Any]) -> str:
        ...

    def merge_properties(self, existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
        ...

    def merge_sources(self, existing: list[str], incoming: str) -> list[str]:
        ...

    def ui_hints(self) -> dict[str, Any]:
        ...
