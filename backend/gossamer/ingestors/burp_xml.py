from __future__ import annotations

from pathlib import Path
from urllib.parse import urlparse

import defusedxml.ElementTree as ET

from gossamer.ingestors.base import Ingestor
from gossamer.ingestors.registry import register_ingestor
from gossamer.models import IngestContext, RawEdge, RawNode, RawObservationBatch


class BurpXmlIngestor(Ingestor):
    name = "burp_xml"

    def can_handle(self, path: Path, mime: str | None = None) -> bool:
        if path.suffix.lower() != ".xml":
            return False
        try:
            head = path.read_text(encoding="utf-8", errors="ignore")[:2000]
        except OSError:
            return False
        return "<items>" in head or "burp" in head.lower() or "<item>" in head

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
        tree = ET.parse(str(ctx.path))
        root = tree.getroot()
        for item in root.findall(".//item"):
            url_el = item.find("url")
            method_el = item.find("method")
            if url_el is None or url_el.text is None:
                continue
            url = url_el.text.strip()
            method = (method_el.text.strip().upper() if method_el is not None and method_el.text else "GET")
            p = urlparse(url)
            host = (p.hostname or "").lower()
            if not host:
                continue
            host_key = host
            ep_key = f"{method}|{url}"
            status_el = item.find("status")
            status = int(status_el.text) if status_el is not None and status_el.text and status_el.text.isdigit() else None
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
                    properties={"url": url, "method": method, "status_code": status},
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


register_ingestor(BurpXmlIngestor())
