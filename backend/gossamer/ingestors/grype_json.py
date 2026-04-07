from __future__ import annotations

import json
from pathlib import Path

from gossamer.ingestors.base import Ingestor
from gossamer.ingestors.finding_helpers import emit_finding_on_target, ensure_source
from gossamer.ingestors.registry import register_ingestor
from gossamer.models import IngestContext, RawObservationBatch


class GrypeJsonIngestor(Ingestor):
    name = "grype_json"

    def can_handle(self, path: Path, mime: str | None = None) -> bool:
        if path.suffix.lower() != ".json":
            return False
        try:
            head = path.read_text(encoding="utf-8", errors="ignore")[:12000]
        except OSError:
            return False
        if '"matches"' not in head:
            return False
        try:
            data = json.loads(path.read_text(encoding="utf-8", errors="ignore"))
        except (json.JSONDecodeError, OSError):
            return False
        return isinstance(data, dict) and isinstance(data.get("matches"), list)

    def ingest(self, ctx: IngestContext) -> RawObservationBatch:
        batch = RawObservationBatch()
        source_key = ensure_source(batch, ingestor_name=self.name, source_label=ctx.source_label)
        try:
            data = json.loads(ctx.path.read_text(encoding="utf-8", errors="ignore"))
        except (json.JSONDecodeError, OSError):
            return batch

        for m in data.get("matches") or [] if isinstance(data, dict) else []:
            if not isinstance(m, dict):
                continue
            vuln = m.get("vulnerability") or {}
            vid = str(vuln.get("id") or "")
            sev = str(vuln.get("severity") or "unknown").lower()
            desc = str(vuln.get("description") or "")[:1500]
            urls = vuln.get("urls") or []
            primary = ""
            if isinstance(urls, list) and urls:
                primary = str(urls[0])
            art = m.get("artifact") or {}
            name = str(art.get("name") or "")
            ver = str(art.get("version") or "")
            art_type = str(art.get("type") or "")
            ref = primary if primary.startswith("http") else f"pkg:grype:{art_type}:{name}@{ver}"
            vc = ""
            md = m.get("matchDetails")
            if isinstance(md, dict):
                found = md.get("found")
                if isinstance(found, dict):
                    vc = str(found.get("versionConstraint") or "")

            emit_finding_on_target(
                batch,
                scanner="grype",
                dedup_parts=(vid, name, ver, vc),
                target_uri=ref,
                method="GET",
                source_label=ctx.source_label,
                source_key=source_key,
                finding_props={
                    "scanner": "grype",
                    "name": vid or name or "Grype match",
                    "severity": sev,
                    "template_id": vid or None,
                    "cve": vid or None,
                    "package": name or None,
                    "installed_version": ver or None,
                    "artifact_type": art_type or None,
                    "description": desc or None,
                    "reference_url": primary or None,
                },
                edge_props={"cve": vid, "package": name},
            )
        return batch


register_ingestor(GrypeJsonIngestor())
