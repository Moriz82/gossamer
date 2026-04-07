from __future__ import annotations

import json
from pathlib import Path

from gossamer.ingestors.base import Ingestor
from gossamer.ingestors.finding_helpers import emit_finding_on_target, ensure_source
from gossamer.ingestors.registry import register_ingestor
from gossamer.models import IngestContext, RawObservationBatch


class DependencyCheckJsonIngestor(Ingestor):
    name = "dependency_check_json"

    def can_handle(self, path: Path, mime: str | None = None) -> bool:
        if path.suffix.lower() != ".json":
            return False
        try:
            head = path.read_text(encoding="utf-8", errors="ignore")[:16000]
        except OSError:
            return False
        if '"dependencies"' not in head or '"vulnerabilities"' not in head:
            return False
        try:
            data = json.loads(path.read_text(encoding="utf-8", errors="ignore"))
        except (json.JSONDecodeError, OSError):
            return False
        return isinstance(data, dict) and isinstance(data.get("dependencies"), list)

    def ingest(self, ctx: IngestContext) -> RawObservationBatch:
        batch = RawObservationBatch()
        source_key = ensure_source(batch, ingestor_name=self.name, source_label=ctx.source_label)
        try:
            data = json.loads(ctx.path.read_text(encoding="utf-8", errors="ignore"))
        except (json.JSONDecodeError, OSError):
            return batch

        for dep in data.get("dependencies") or []:
            if not isinstance(dep, dict):
                continue
            file_name = str(dep.get("fileName") or dep.get("filePath") or "dependency")
            for v in dep.get("vulnerabilities") or []:
                if not isinstance(v, dict):
                    continue
                name = str(v.get("name") or v.get("source") or "")
                sev = str(v.get("severity") or "unknown").lower()
                desc = str(v.get("description") or "")[:1200]
                ref = f"pkg:dependency-check:{file_name}|{name}"

                emit_finding_on_target(
                    batch,
                    scanner="dependency_check",
                    dedup_parts=(name, file_name, str(v.get("cvssv3", {}).get("baseScore", ""))),
                    target_uri=ref,
                    method="GET",
                    source_label=ctx.source_label,
                    source_key=source_key,
                    finding_props={
                        "scanner": "dependency-check",
                        "name": name or "Dependency finding",
                        "severity": sev,
                        "template_id": name or None,
                        "file": file_name,
                        "description": desc or None,
                    },
                    edge_props={"name": name},
                )
        return batch


register_ingestor(DependencyCheckJsonIngestor())
