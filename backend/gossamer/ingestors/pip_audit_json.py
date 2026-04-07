from __future__ import annotations

import json
from pathlib import Path

from gossamer.ingestors.base import Ingestor
from gossamer.ingestors.finding_helpers import emit_finding_on_target, ensure_source
from gossamer.ingestors.registry import register_ingestor
from gossamer.models import IngestContext, RawObservationBatch


class PipAuditJsonIngestor(Ingestor):
    name = "pip_audit_json"

    def can_handle(self, path: Path, mime: str | None = None) -> bool:
        if path.suffix.lower() != ".json":
            return False
        try:
            data = json.loads(path.read_text(encoding="utf-8", errors="ignore")[:240000])
        except (json.JSONDecodeError, OSError):
            return False
        if not isinstance(data, list) or not data or not isinstance(data[0], dict):
            return False
        row = data[0]
        return ("vuln_id" in row or "id" in row) and "name" in row and (
            "version" in row or "installed_version" in row
        )

    def ingest(self, ctx: IngestContext) -> RawObservationBatch:
        batch = RawObservationBatch()
        source_key = ensure_source(batch, ingestor_name=self.name, source_label=ctx.source_label)
        try:
            data = json.loads(ctx.path.read_text(encoding="utf-8", errors="ignore"))
        except (json.JSONDecodeError, OSError):
            return batch
        if not isinstance(data, list):
            return batch

        for row in data:
            if not isinstance(row, dict):
                continue
            name = str(row.get("name") or "")
            ver = str(row.get("version") or row.get("installed_version") or "")
            vid = str(row.get("vuln_id") or row.get("id") or "")
            fix = row.get("fix_versions")
            link = str(row.get("link") or "")
            sev = str(row.get("severity") or "unknown").lower()
            ref = link if link.startswith("http") else f"pkg:pypi:{name}@{ver}"

            emit_finding_on_target(
                batch,
                scanner="pip_audit",
                dedup_parts=(name, ver, vid),
                target_uri=ref,
                method="GET",
                source_label=ctx.source_label,
                source_key=source_key,
                finding_props={
                    "scanner": "pip-audit",
                    "name": vid or f"{name} vulnerability",
                    "severity": sev,
                    "template_id": vid or None,
                    "package": name,
                    "installed_version": ver or None,
                    "fix_versions": fix if isinstance(fix, list) else None,
                },
                edge_props={"vuln_id": vid},
            )
        return batch


register_ingestor(PipAuditJsonIngestor())
