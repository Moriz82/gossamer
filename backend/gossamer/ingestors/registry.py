from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from gossamer.ingestors.base import Ingestor

_REGISTRY: list["Ingestor"] = []


def register_ingestor(ing: "Ingestor") -> None:
    _REGISTRY.append(ing)


def all_ingestors() -> list["Ingestor"]:
    return list(_REGISTRY)


def get_ingestor(path: Path, mime: str | None = None, hint: str | None = None) -> "Ingestor | None":
    if hint:
        for ing in _REGISTRY:
            if ing.name == hint:
                return ing
    for ing in _REGISTRY:
        if ing.can_handle(path, mime):
            return ing
    return None
