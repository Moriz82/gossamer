from __future__ import annotations

import json
from pathlib import Path

from gossamer.ingestors.base import Ingestor
from gossamer.ingestors.finding_helpers import emit_finding_on_target, ensure_source
from gossamer.ingestors.registry import register_ingestor
from gossamer.models import IngestContext, RawObservationBatch


class SemgrepJsonIngestor(Ingestor):
    name = "semgrep_json"

    def can_handle(self, path: Path, mime: str | None = None) -> bool:
        if path.suffix.lower() not in (".json",):
            return False
        try:
            data = json.loads(path.read_text(encoding="utf-8", errors="ignore")[:48000])
        except (json.JSONDecodeError, OSError):
            return False
        if not isinstance(data, dict):
            return False
        if data.get("runs") is not None:
            return False
        if not isinstance(data.get("results"), list):
            return False
        if "metrics" in data or "bandit_version" in data:
            return False
        return bool(data.get("version")) or "paths" in data

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
            check_id = str(r.get("check_id") or "")
            path_s = str(r.get("path") or "")
            extra = r.get("extra") if isinstance(r.get("extra"), dict) else {}
            message = str(extra.get("message") or check_id)
            sev = str(extra.get("severity") or "medium").lower()
            start = r.get("start") if isinstance(r.get("start"), dict) else {}
            line = str(start.get("line") or "")

            ref = path_s if path_s.startswith("file:") else f"file://{path_s.lstrip('/')}"

            emit_finding_on_target(
                batch,
                scanner="semgrep",
                dedup_parts=(check_id, path_s, line, message[:160]),
                target_uri=ref,
                method="GET",
                source_label=ctx.source_label,
                source_key=source_key,
                finding_props={
                    "scanner": "semgrep",
                    "name": message[:500] or check_id,
                    "severity": sev,
                    "template_id": check_id or None,
                    "rule_id": check_id or None,
                    "line": start.get("line") if isinstance(start.get("line"), int) else None,
                },
                edge_props={"check_id": check_id},
            )
        return batch


register_ingestor(SemgrepJsonIngestor())
