from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class IngestContext:
    """Context passed to ingestors (file path, source label, options)."""

    path: Path
    source_label: str
    options: dict[str, Any] = field(default_factory=dict)


@dataclass
class RawNode:
    kind: str
    key: str
    properties: dict[str, Any]
    source: str


@dataclass
class RawEdge:
    kind: str
    src_kind: str
    src_key: str
    dst_kind: str
    dst_key: str
    properties: dict[str, Any]
    source: str


@dataclass
class RawObservationBatch:
    nodes: list[RawNode] = field(default_factory=list)
    edges: list[RawEdge] = field(default_factory=list)


@dataclass
class NormalizedNode:
    id: str
    kind: str
    key: str
    properties: dict[str, Any]
    source: str


@dataclass
class NormalizedEdge:
    id: str
    kind: str
    src_id: str
    dst_id: str
    properties: dict[str, Any]
    source: str
