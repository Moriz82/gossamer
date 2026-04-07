from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import urlparse

from gossamer.ingestors.base import Ingestor
from gossamer.ingestors.finding_helpers import emit_finding_on_target, ensure_source
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


def _risk_to_severity(riskdesc: str) -> str:
    s = (riskdesc or "").lower()
    if "high" in s:
        return "high"
    if "medium" in s:
        return "medium"
    if "low" in s:
        return "low"
    return "info"


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
        source_key = ensure_source(batch, ingestor_name=self.name, source_label=ctx.source_label)
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
                name = str(alert.get("name") or "")
                pluginid = str(alert.get("pluginid") or "")
                cwe = alert.get("cweid")
                riskdesc = str(alert.get("riskdesc") or alert.get("risk") or "")
                sev = _risk_to_severity(riskdesc)
                desc = str(alert.get("desc") or "")[:1200]
                instances = alert.get("instances") or []
                for inst in instances:
                    if not isinstance(inst, dict):
                        continue
                    uri = inst.get("uri") or inst.get("url")
                    if not uri:
                        continue
                    method = str(inst.get("method") or "GET")
                    emit_finding_on_target(
                        batch,
                        scanner="zap",
                        dedup_parts=(pluginid, name, str(uri), method),
                        target_uri=str(uri),
                        method=method,
                        source_label=ctx.source_label,
                        source_key=source_key,
                        finding_props={
                            "scanner": "zap",
                            "name": name or "ZAP alert",
                            "severity": sev,
                            "template_id": pluginid or None,
                            "plugin_id": pluginid or None,
                            "cwe_id": str(cwe) if cwe is not None else None,
                            "description": desc or None,
                            "risk": riskdesc or None,
                        },
                        edge_props={"plugin_id": pluginid},
                    )
        return batch


register_ingestor(ZapJsonIngestor())
