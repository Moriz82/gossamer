from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import urljoin, urlparse

from gossamer.ingestors.base import Ingestor
from gossamer.ingestors.registry import register_ingestor
from gossamer.models import IngestContext, RawEdge, RawNode, RawObservationBatch

_HREF_RE = re.compile(r'href=["\']([^"\']+)["\']', re.I)


class KatanaJsonlIngestor(Ingestor):
    name = "katana_jsonl"

    def can_handle(self, path: Path, mime: str | None = None) -> bool:
        if path.suffix.lower() not in (".jsonl", ".ndjson", ".txt", ".json"):
            return False
        try:
            sample = path.read_text(encoding="utf-8", errors="ignore")[:4096]
        except OSError:
            return False
        return '"request"' in sample and '"endpoint"' in sample

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
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            req = obj.get("request") or {}
            url = req.get("endpoint") or obj.get("url")
            if not url:
                continue
            method = (req.get("method") or "GET").upper()
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
                    properties={"url": str(url), "method": method},
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
            # Optional response body link extraction for links_to
            body = (obj.get("response") or {}).get("body") or obj.get("body")
            if isinstance(body, str) and len(body) < 2_000_000:
                for m in _HREF_RE.findall(body):
                    dest = urljoin(str(url), m)
                    dp = urlparse(dest)
                    dh = (dp.hostname or "").lower()
                    if not dh:
                        continue
                    dh_key = dh
                    dest_method = "GET"
                    dest_key = f"{dest_method}|{dest}"
                    batch.nodes.append(
                        RawNode(
                            kind="Host",
                            key=dh_key,
                            properties={"hostname": dh},
                            source=ctx.source_label,
                        )
                    )
                    batch.nodes.append(
                        RawNode(
                            kind="Endpoint",
                            key=dest_key,
                            properties={"url": dest, "method": dest_method},
                            source=ctx.source_label,
                        )
                    )
                    batch.edges.append(
                        RawEdge(
                            kind="serves",
                            src_kind="Host",
                            src_key=dh_key,
                            dst_kind="Endpoint",
                            dst_key=dest_key,
                            properties={"scheme": dp.scheme},
                            source=ctx.source_label,
                        )
                    )
                    batch.edges.append(
                        RawEdge(
                            kind="links_to",
                            src_kind="Endpoint",
                            src_key=ep_key,
                            dst_kind="Endpoint",
                            dst_key=dest_key,
                            properties={"via": "href"},
                            source=ctx.source_label,
                        )
                    )
        return batch


register_ingestor(KatanaJsonlIngestor())
