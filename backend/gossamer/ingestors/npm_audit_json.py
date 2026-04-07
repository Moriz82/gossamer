from __future__ import annotations

import json
from pathlib import Path

from gossamer.ingestors.base import Ingestor
from gossamer.ingestors.finding_helpers import emit_finding_on_target, ensure_source
from gossamer.ingestors.registry import register_ingestor
from gossamer.models import IngestContext, RawObservationBatch


class NpmAuditJsonIngestor(Ingestor):
    name = "npm_audit_json"

    def can_handle(self, path: Path, mime: str | None = None) -> bool:
        if path.suffix.lower() != ".json":
            return False
        try:
            data = json.loads(path.read_text(encoding="utf-8", errors="ignore")[:48000])
        except (json.JSONDecodeError, OSError):
            return False
        if not isinstance(data, dict) or not isinstance(data.get("vulnerabilities"), dict):
            return False
        # npm audit JSON; avoid confusion with snyk which also has vulnerabilities list at top level
        return "metadata" in data or "auditReportVersion" in data or (
            isinstance(data["vulnerabilities"], dict) and all(isinstance(k, str) for k in list(data["vulnerabilities"])[:3])
        )

    def ingest(self, ctx: IngestContext) -> RawObservationBatch:
        batch = RawObservationBatch()
        source_key = ensure_source(batch, ingestor_name=self.name, source_label=ctx.source_label)
        try:
            data = json.loads(ctx.path.read_text(encoding="utf-8", errors="ignore"))
        except (json.JSONDecodeError, OSError):
            return batch

        for pkg, block in (data.get("vulnerabilities") or {}).items():
            if not isinstance(block, dict):
                continue
            pkg_name = str(block.get("name") or pkg)
            sev_block = str(block.get("severity") or "unknown").lower()
            for via in block.get("via") or []:
                if isinstance(via, str):
                    continue
                if not isinstance(via, dict):
                    continue
                title = str(via.get("title") or via.get("name") or "npm advisory")
                vid = str(via.get("source") or via.get("url") or title)[:120]
                url = str(via.get("url") or "")
                sev = str(via.get("severity") or sev_block).lower()
                ref = url if url.startswith("http") else f"pkg:npm:{pkg_name}"

                emit_finding_on_target(
                    batch,
                    scanner="npm_audit",
                    dedup_parts=(pkg_name, title, vid),
                    target_uri=ref,
                    method="GET",
                    source_label=ctx.source_label,
                    source_key=source_key,
                    finding_props={
                        "scanner": "npm-audit",
                        "name": title,
                        "severity": sev,
                        "template_id": vid or None,
                        "package": pkg_name,
                    },
                    edge_props={"package": pkg_name},
                )
        return batch


register_ingestor(NpmAuditJsonIngestor())
