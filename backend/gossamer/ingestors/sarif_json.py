from __future__ import annotations

import json
from pathlib import Path

from gossamer.ingestors.base import Ingestor
from gossamer.ingestors.finding_helpers import emit_finding_on_target, ensure_source
from gossamer.ingestors.registry import register_ingestor
from gossamer.models import IngestContext, RawObservationBatch

def _level_to_severity(level: str) -> str:
    m = (level or "warning").lower()
    return {"error": "high", "warning": "medium", "note": "low", "none": "info"}.get(m, "medium")


class SarifJsonIngestor(Ingestor):
    name = "sarif_json"

    def can_handle(self, path: Path, mime: str | None = None) -> bool:
        if path.suffix.lower() not in (".json", ".sarif"):
            return False
        try:
            head = path.read_text(encoding="utf-8", errors="ignore")[:16000]
        except OSError:
            return False
        low = head.lower()
        if "sarif" not in low:
            return False
        if '"runs"' not in head and "'runs'" not in head:
            return False
        try:
            data = json.loads(path.read_text(encoding="utf-8", errors="ignore"))
        except (json.JSONDecodeError, OSError):
            return False
        return isinstance(data, dict) and isinstance(data.get("runs"), list)

    def ingest(self, ctx: IngestContext) -> RawObservationBatch:
        batch = RawObservationBatch()
        source_key = ensure_source(batch, ingestor_name=self.name, source_label=ctx.source_label)
        try:
            data = json.loads(ctx.path.read_text(encoding="utf-8", errors="ignore"))
        except (json.JSONDecodeError, OSError):
            return batch
        if not isinstance(data, dict):
            return batch

        for run in data.get("runs") or []:
            if not isinstance(run, dict):
                continue
            driver = (run.get("tool") or {}).get("driver") or {}
            tool = str(driver.get("name") or "sarif").lower().replace(" ", "_")
            for res in run.get("results") or []:
                if not isinstance(res, dict):
                    continue
                rule_id = str(res.get("ruleId") or "")
                msg = res.get("message") or {}
                text = str(msg.get("text") or msg.get("markdown") or "")[:2000]
                severity = _level_to_severity(str(res.get("level") or ""))
                uri = ""
                for loc in res.get("locations") or []:
                    if not isinstance(loc, dict):
                        continue
                    phys = loc.get("physicalLocation") or {}
                    art = phys.get("artifactLocation") or {}
                    uri = str(art.get("uri") or "").strip()
                    if uri:
                        break
                if not uri:
                    continue
                emit_finding_on_target(
                    batch,
                    scanner="sarif",
                    dedup_parts=(tool, rule_id, text[:240], uri),
                    target_uri=uri,
                    method="GET",
                    source_label=ctx.source_label,
                    source_key=source_key,
                    finding_props={
                        "scanner": tool or "sarif",
                        "tool": tool,
                        "name": text[:500] or rule_id or "SARIF finding",
                        "severity": severity,
                        "rule_id": rule_id or None,
                        "template_id": rule_id or None,
                        "description": text or None,
                    },
                    edge_props={"rule_id": rule_id},
                )
        return batch


register_ingestor(SarifJsonIngestor())
