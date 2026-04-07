from __future__ import annotations

import json
from pathlib import Path

from gossamer.ingestors.base import Ingestor
from gossamer.ingestors.finding_helpers import emit_finding_on_target, ensure_source
from gossamer.ingestors.registry import register_ingestor
from gossamer.models import IngestContext, RawObservationBatch


class SnykTestJsonIngestor(Ingestor):
    name = "snyk_test_json"

    def can_handle(self, path: Path, mime: str | None = None) -> bool:
        if path.suffix.lower() != ".json":
            return False
        try:
            data = json.loads(path.read_text(encoding="utf-8", errors="ignore")[:24000])
        except (json.JSONDecodeError, OSError):
            return False
        if not isinstance(data, dict):
            return False
        if not isinstance(data.get("vulnerabilities"), list):
            return False
        # Distinguish from generic objects: Snyk test output includes package identity
        return "packageName" in str(data)[:8000] or "packageManager" in data

    def ingest(self, ctx: IngestContext) -> RawObservationBatch:
        batch = RawObservationBatch()
        source_key = ensure_source(batch, ingestor_name=self.name, source_label=ctx.source_label)
        try:
            data = json.loads(ctx.path.read_text(encoding="utf-8", errors="ignore"))
        except (json.JSONDecodeError, OSError):
            return batch

        for v in data.get("vulnerabilities") or []:
            if not isinstance(v, dict):
                continue
            title = str(v.get("title") or "")
            vid = str(v.get("id") or "")
            pkg = str(v.get("packageName") or "")
            sev = str(v.get("severity") or "unknown").lower()
            url = ""
            for ref in v.get("references") or []:
                if isinstance(ref, dict) and ref.get("url"):
                    url = str(ref["url"])
                    break
            ref = url if url.startswith("http") else f"pkg:snyk:{pkg}|{vid}"

            emit_finding_on_target(
                batch,
                scanner="snyk",
                dedup_parts=(vid, pkg, title),
                target_uri=ref,
                method="GET",
                source_label=ctx.source_label,
                source_key=source_key,
                finding_props={
                    "scanner": "snyk",
                    "name": title or vid or "Snyk vulnerability",
                    "severity": sev,
                    "template_id": vid or None,
                    "package": pkg or None,
                    "from": v.get("from") if isinstance(v.get("from"), list) else None,
                },
                edge_props={"id": vid},
            )
        return batch


register_ingestor(SnykTestJsonIngestor())
