from __future__ import annotations

import json
from pathlib import Path

from gossamer.ingestors.base import Ingestor
from gossamer.ingestors.finding_helpers import emit_finding_on_target, ensure_source
from gossamer.ingestors.registry import register_ingestor
from gossamer.models import IngestContext, RawObservationBatch


class BanditJsonIngestor(Ingestor):
    name = "bandit_json"

    def can_handle(self, path: Path, mime: str | None = None) -> bool:
        if path.suffix.lower() != ".json":
            return False
        try:
            data = json.loads(path.read_text(encoding="utf-8", errors="ignore")[:32000])
        except (json.JSONDecodeError, OSError):
            return False
        if not isinstance(data, dict):
            return False
        return isinstance(data.get("results"), list) and (
            "metrics" in data or "bandit_version" in data
        )

    def ingest(self, ctx: IngestContext) -> RawObservationBatch:
        batch = RawObservationBatch()
        source_key = ensure_source(batch, ingestor_name=self.name, source_label=ctx.source_label)
        try:
            data = json.loads(ctx.path.read_text(encoding="utf-8", errors="ignore"))
        except (json.JSONDecodeError, OSError):
            return batch

        for r in data.get("results") or []:
            if not isinstance(r, dict):
                continue
            path_s = str(r.get("filename") or "")
            test_id = str(r.get("test_id") or "")
            cwe = r.get("issue_cwe")
            cwe_bit = str(cwe.get("id")) if isinstance(cwe, dict) and cwe.get("id") is not None else ""
            issue_text = str(r.get("issue_text") or cwe_bit or "")
            sev = str(r.get("issue_severity") or "unknown").lower()
            line = str(r.get("line_number") or "")

            ref = path_s if path_s.startswith("file:") else f"file://{path_s.lstrip('/')}"

            emit_finding_on_target(
                batch,
                scanner="bandit",
                dedup_parts=(test_id, path_s, line, issue_text[:120]),
                target_uri=ref,
                method="GET",
                source_label=ctx.source_label,
                source_key=source_key,
                finding_props={
                    "scanner": "bandit",
                    "name": issue_text[:400] or test_id,
                    "severity": sev,
                    "template_id": test_id or None,
                    "test_id": test_id or None,
                    "line": int(r["line_number"]) if isinstance(r.get("line_number"), int) else line or None,
                },
                edge_props={"test_id": test_id},
            )
        return batch


register_ingestor(BanditJsonIngestor())
