from __future__ import annotations

import json
from pathlib import Path

from gossamer.ingestors.base import Ingestor
from gossamer.ingestors.finding_helpers import emit_finding_on_target, ensure_source
from gossamer.ingestors.registry import register_ingestor
from gossamer.models import IngestContext, RawObservationBatch


class CheckovJsonIngestor(Ingestor):
    name = "checkov_json"

    def can_handle(self, path: Path, mime: str | None = None) -> bool:
        if path.suffix.lower() != ".json":
            return False
        try:
            data = json.loads(path.read_text(encoding="utf-8", errors="ignore")[:48000])
        except (json.JSONDecodeError, OSError):
            return False
        if not isinstance(data, dict) or "check_type" not in data:
            return False
        results = data.get("results")
        return isinstance(results, dict) and isinstance(results.get("failed_checks"), list)

    def ingest(self, ctx: IngestContext) -> RawObservationBatch:
        batch = RawObservationBatch()
        source_key = ensure_source(batch, ingestor_name=self.name, source_label=ctx.source_label)
        try:
            data = json.loads(ctx.path.read_text(encoding="utf-8", errors="ignore"))
        except (json.JSONDecodeError, OSError):
            return batch
        check_type = str(data.get("check_type") or "")

        for ck in (data.get("results") or {}).get("failed_checks") or []:
            if not isinstance(ck, dict):
                continue
            cid = str(ck.get("check_id") or "")
            name = str(ck.get("check_name") or cid)
            file_path = str(ck.get("file_abs_path") or ck.get("file_path") or "")
            sev = str(ck.get("severity") or "medium").lower()
            ref = f"file://{file_path.lstrip('/')}" if file_path else f"pkg:checkov:{check_type}|{cid}"

            emit_finding_on_target(
                batch,
                scanner="checkov",
                dedup_parts=(check_type, cid, file_path),
                target_uri=ref,
                method="GET",
                source_label=ctx.source_label,
                source_key=source_key,
                finding_props={
                    "scanner": "checkov",
                    "name": name,
                    "severity": sev,
                    "template_id": cid or None,
                    "check_type": check_type or None,
                    "file_path": file_path or None,
                },
                edge_props={"check_id": cid},
            )
        return batch


register_ingestor(CheckovJsonIngestor())
