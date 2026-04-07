from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path

from gossamer.models import IngestContext, RawObservationBatch


class Ingestor(ABC):
    """One module per format; register in ingestors/registry.py."""

    name: str

    @abstractmethod
    def can_handle(self, path: Path, mime: str | None = None) -> bool:
        ...

    @abstractmethod
    def ingest(self, ctx: IngestContext) -> RawObservationBatch:
        ...
