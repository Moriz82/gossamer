from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import urlparse

from gossamer.ingestors.base import Ingestor
from gossamer.ingestors.registry import register_ingestor
from gossamer.models import IngestContext, RawEdge, RawNode, RawObservationBatch


def _emit_url(batch: RawObservationBatch, url: str, method: str, source_label: str, source_key: str) -> None:
    p = urlparse(url)
    host = (p.hostname or "").lower()
    if not host:
        return
    host_key = host
    method = method.upper() if method else "GET"
    ep_key = f"{method}|{url}"
    batch.nodes.append(
        RawNode(
            kind="Host",
            key=host_key,
            properties={"hostname": host},
            source=source_label,
        )
    )
    batch.nodes.append(
        RawNode(
            kind="Endpoint",
            key=ep_key,
            properties={"url": url, "method": method},
            source=source_label,
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
            source=source_label,
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
            source=source_label,
        )
    )


class ZapJsonIngestor(Ingestor):
    name = "zap_json"

    def can_handle(self, path: Path, mime: str | None = None) -> bool:
        if path.suffix.lower() != ".json":
            return False
        try:
            data = json.loads(path.read_text(encoding="utf-8", errors="ignore")[:8000])
        except (json.JSONDecodeError, OSError):
            return False
        if isinstance(data, dict) and "site" in data:
            return True
        if isinstance(data, dict) and "programName" in data and "site" in str(data):
            return True
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
        data = json.loads(ctx.path.read_text(encoding="utf-8", errors="ignore"))
        sites = data.get("site") if isinstance(data, dict) else None
        if not isinstance(sites, list):
            urls = data.get("urls") if isinstance(data, dict) else None
            if isinstance(urls, list):
                for u in urls:
                    if isinstance(u, dict):
                        _emit_url(
                            batch,
                            u.get("uri") or u.get("url") or "",
                            u.get("method") or "GET",
                            ctx.source_label,
                            source_key,
                        )
                return batch
            return batch

        for site in sites:
            if not isinstance(site, dict):
                continue
            alerts = site.get("alerts") or []
            for alert in alerts:
                if not isinstance(alert, dict):
                    continue
                instances = alert.get("instances") or []
                for inst in instances:
                    if not isinstance(inst, dict):
                        continue
                    uri = inst.get("uri") or inst.get("url")
                    if not uri:
                        continue
                    method = inst.get("method") or "GET"
                    _emit_url(batch, str(uri), str(method), ctx.source_label, source_key)
        return batch


register_ingestor(ZapJsonIngestor())
