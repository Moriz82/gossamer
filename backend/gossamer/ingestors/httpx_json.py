from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import urlparse

from gossamer.ingestors.base import Ingestor
from gossamer.ingestors.registry import register_ingestor
from gossamer.models import IngestContext, RawEdge, RawNode, RawObservationBatch


def _host_from_url(url: str) -> str:
    p = urlparse(url)
    return (p.hostname or "").lower()


def _method(obj: dict) -> str:
    return (obj.get("method") or obj.get("request", {}).get("method") or "GET").upper()


class HttpxJsonIngestor(Ingestor):
    name = "httpx_json"

    def can_handle(self, path: Path, mime: str | None = None) -> bool:
        suf = path.suffix.lower()
        if suf in (".jsonl", ".ndjson"):
            return True
        if suf == ".json":
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")[:4096]
                if '"url"' in text and ("input" in text or "status_code" in text or "webserver" in text):
                    return True
            except OSError:
                return False
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

        lines = ctx.path.read_text(encoding="utf-8", errors="ignore").splitlines()
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            url = obj.get("url")
            if not url:
                continue
            method = _method(obj)
            host = _host_from_url(str(url))
            if not host:
                continue
            host_key = host
            ep_key = f"{method}|{url}"
            tech = obj.get("technologies") or obj.get("tech") or []
            if isinstance(obj.get("tech"), str):
                tech = [obj["tech"]]
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
                        "status_code": obj.get("status_code"),
                        "title": obj.get("title"),
                        "webserver": obj.get("webserver"),
                        "technologies": tech if isinstance(tech, list) else [],
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
                    properties={"scheme": urlparse(str(url)).scheme},
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


register_ingestor(HttpxJsonIngestor())
