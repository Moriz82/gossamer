from __future__ import annotations

import json
from pathlib import Path

from gossamer.ingestors.base import Ingestor
from gossamer.ingestors.finding_helpers import emit_finding_on_target, ensure_source
from gossamer.ingestors.registry import register_ingestor
from gossamer.models import IngestContext, RawObservationBatch


class WpScanJsonIngestor(Ingestor):
    name = "wpscan_json"

    def can_handle(self, path: Path, mime: str | None = None) -> bool:
        if path.suffix.lower() != ".json":
            return False
        try:
            head = path.read_text(encoding="utf-8", errors="ignore")[:8000]
        except OSError:
            return False
        if '"target_url"' not in head:
            return False
        try:
            data = json.loads(path.read_text(encoding="utf-8", errors="ignore"))
        except (json.JSONDecodeError, OSError):
            return False
        return isinstance(data, dict) and bool(str(data.get("target_url") or "").strip())

    def ingest(self, ctx: IngestContext) -> RawObservationBatch:
        batch = RawObservationBatch()
        source_key = ensure_source(batch, ingestor_name=self.name, source_label=ctx.source_label)
        try:
            data = json.loads(ctx.path.read_text(encoding="utf-8", errors="ignore"))
        except (json.JSONDecodeError, OSError):
            return batch
        base = str(data.get("target_url") or "").rstrip("/")

        def emit_plugin_vulns(slug: str, plug: dict) -> None:
            for vuln in plug.get("vulnerabilities") or []:
                if not isinstance(vuln, dict):
                    continue
                title = str(vuln.get("title") or slug)
                ref = base
                refs = vuln.get("references")
                if isinstance(refs, dict):
                    u = refs.get("url")
                    if isinstance(u, list) and u:
                        ref = str(u[0])
                    elif isinstance(u, str):
                        ref = u
                elif isinstance(refs, list) and refs:
                    ref = str(refs[0])
                if not ref.startswith("http"):
                    ref = base
                emit_finding_on_target(
                    batch,
                    scanner="wpscan",
                    dedup_parts=(slug, title, str(vuln.get("fixed_in") or "")),
                    target_uri=ref,
                    method="GET",
                    source_label=ctx.source_label,
                    source_key=source_key,
                    finding_props={
                        "scanner": "wpscan",
                        "name": title,
                        "severity": "high" if "RCE" in title or "SQL" in title else "medium",
                        "template_id": slug + ":" + title[:80],
                        "component": slug,
                    },
                    edge_props={"plugin": slug},
                )

        for slug, plug in (data.get("plugins") or {}).items():
            if isinstance(plug, dict):
                emit_plugin_vulns(str(slug), plug)

        for key, block in (data.get("interesting_findings") or {}).items():
            if not isinstance(block, dict):
                continue
            ref = str(block.get("url") or base)
            emit_finding_on_target(
                batch,
                scanner="wpscan",
                dedup_parts=("interesting", str(key), ref),
                target_uri=ref,
                method="GET",
                source_label=ctx.source_label,
                source_key=source_key,
                finding_props={
                    "scanner": "wpscan",
                    "name": str(block.get("title") or key),
                    "severity": "info",
                    "template_id": str(key),
                },
                edge_props={"kind": "interesting"},
            )

        ver = data.get("version") if isinstance(data.get("version"), dict) else None
        if isinstance(ver, dict) and ver.get("vulnerabilities"):
            for vuln in ver.get("vulnerabilities") or []:
                if not isinstance(vuln, dict):
                    continue
                title = str(vuln.get("title") or "WordPress core")
                emit_finding_on_target(
                    batch,
                    scanner="wpscan",
                    dedup_parts=("core", title, str(vuln.get("fixed_in") or "")),
                    target_uri=base,
                    method="GET",
                    source_label=ctx.source_label,
                    source_key=source_key,
                    finding_props={
                        "scanner": "wpscan",
                        "name": title,
                        "severity": "high",
                        "template_id": "wordpress-core",
                        "component": "wordpress",
                    },
                    edge_props={"component": "core"},
                )

        return batch


register_ingestor(WpScanJsonIngestor())
