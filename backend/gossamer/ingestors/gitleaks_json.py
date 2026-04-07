from __future__ import annotations

import json
from pathlib import Path

from gossamer.ingestors.base import Ingestor
from gossamer.ingestors.finding_helpers import emit_finding_on_target, ensure_source
from gossamer.ingestors.registry import register_ingestor
from gossamer.models import IngestContext, RawObservationBatch


class GitleaksJsonIngestor(Ingestor):
    name = "gitleaks_json"

    def can_handle(self, path: Path, mime: str | None = None) -> bool:
        if path.suffix.lower() != ".json":
            return False
        try:
            head = path.read_text(encoding="utf-8", errors="ignore")[:8000]
        except OSError:
            return False
        if '"RuleID"' not in head or '"Description"' not in head:
            return False
        try:
            data = json.loads(path.read_text(encoding="utf-8", errors="ignore"))
        except (json.JSONDecodeError, OSError):
            return False
        if isinstance(data, dict) and isinstance(data.get("findings"), list):
            return True
        return isinstance(data, list) and (len(data) == 0 or isinstance(data[0], dict))

    def ingest(self, ctx: IngestContext) -> RawObservationBatch:
        batch = RawObservationBatch()
        source_key = ensure_source(batch, ingestor_name=self.name, source_label=ctx.source_label)
        try:
            data = json.loads(ctx.path.read_text(encoding="utf-8", errors="ignore"))
        except (json.JSONDecodeError, OSError):
            return batch
        if isinstance(data, dict) and isinstance(data.get("findings"), list):
            data = data["findings"]
        if not isinstance(data, list):
            return batch

        for f in data:
            if not isinstance(f, dict):
                continue
            rule = str(f.get("RuleID") or "")
            desc = str(f.get("Description") or rule)
            file = str(f.get("File") or "")
            line = str(f.get("StartLine") or "")
            secret = str(f.get("Secret") or "")[:60]
            ref = f"file://{file.lstrip('/')}" if file else "pkg:gitleaks:unknown"

            emit_finding_on_target(
                batch,
                scanner="gitleaks",
                dedup_parts=(rule, file, line, secret),
                target_uri=ref,
                method="GET",
                source_label=ctx.source_label,
                source_key=source_key,
                finding_props={
                    "scanner": "gitleaks",
                    "name": desc[:400] or rule,
                    "severity": "high",
                    "template_id": rule or None,
                    "file": file or None,
                    "line": int(f["StartLine"]) if str(f.get("StartLine", "")).isdigit() else None,
                },
                edge_props={"rule": rule},
            )
        return batch


register_ingestor(GitleaksJsonIngestor())
