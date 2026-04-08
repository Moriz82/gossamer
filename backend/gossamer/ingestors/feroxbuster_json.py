"""Ingestor for feroxbuster --json output (newline-delimited JSON)."""
from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import urlparse

from gossamer.ingestors.base import Ingestor
from gossamer.ingestors.registry import register_ingestor
from gossamer.models import IngestContext, RawEdge, RawNode, RawObservationBatch


class FeroxbusterJsonIngestor(Ingestor):
    name = "feroxbuster_json"

    def can_handle(self, path: Path, mime: str | None = None) -> bool:
        if path.suffix.lower() not in (".json", ".jsonl"):
            return False
        try:
            head = path.read_text(encoding="utf-8", errors="ignore")[:4000]
            return '"type"' in head and '"url"' in head and (
                "ferox" in head.lower() or '"content_length"' in head
            )
        except OSError:
            return False

    def ingest(self, ctx: IngestContext) -> RawObservationBatch:
        batch = RawObservationBatch()
        source_key = f"ingestor:{self.name}:{ctx.source_label}"
        batch.nodes.append(
            RawNode(
                kind="Source",
                key=source_key,
                properties={"name": ctx.source_label, "ingestor": self.name},
                source=ctx.source_label,
            )
        )
        for line in ctx.path.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
            except json.JSONDecodeError:
                continue
            # Only process response entries (skip log/stats entries)
            if not isinstance(r, dict) or r.get("type") != "response":
                continue
            url = r.get("url")
            if not url:
                continue
            method = r.get("method", "GET")
            if not isinstance(method, str) or not method.strip():
                method = "GET"
            else:
                method = method.strip().upper()
            p = urlparse(str(url))
            host = (p.hostname or "").lower()
            if not host:
                continue
            host_key = host
            ep_key = f"{method}|{url}"
            batch.nodes.append(
                RawNode(
                    kind="Host",
                    key=host_key,
                    properties={"hostname": host},
                    source=ctx.source_label,
                )
            )
            batch.nodes.append(
                RawNode(
                    kind="Endpoint",
                    key=ep_key,
                    properties={
                        "url": str(url),
                        "method": method,
                        "status_code": r.get("status"),
                        "length": r.get("content_length"),
                    },
                    source=ctx.source_label,
                )
            )
            batch.edges.append(
                RawEdge(
                    kind="serves",
                    src_kind="Host",
                    src_key=host_key,
                    dst_kind="Endpoint",
                    dst_key=ep_key,
                    properties={"scheme": p.scheme},
                    source=ctx.source_label,
                )
            )
            batch.edges.append(
                RawEdge(
                    kind="discovered_by",
                    src_kind="Endpoint",
                    src_key=ep_key,
                    dst_kind="Source",
                    dst_key=source_key,
                    properties={},
                    source=ctx.source_label,
                )
            )
        return batch


register_ingestor(FeroxbusterJsonIngestor())
