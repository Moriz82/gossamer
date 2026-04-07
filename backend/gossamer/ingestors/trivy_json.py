from __future__ import annotations

import json
from pathlib import Path

from gossamer.ingestors.base import Ingestor
from gossamer.ingestors.finding_helpers import emit_finding_on_target, ensure_source
from gossamer.ingestors.registry import register_ingestor
from gossamer.models import IngestContext, RawObservationBatch


class TrivyJsonIngestor(Ingestor):
    name = "trivy_json"

    def can_handle(self, path: Path, mime: str | None = None) -> bool:
        if path.suffix.lower() != ".json":
            return False
        try:
            head = path.read_text(encoding="utf-8", errors="ignore")[:12000]
        except OSError:
            return False
        if '"SchemaVersion"' not in head or '"Results"' not in head:
            return False
        try:
            data = json.loads(path.read_text(encoding="utf-8", errors="ignore"))
        except (json.JSONDecodeError, OSError):
            return False
        return (
            isinstance(data, dict)
            and isinstance(data.get("Results"), list)
            and "ArtifactName" in data
        )

    def ingest(self, ctx: IngestContext) -> RawObservationBatch:
        batch = RawObservationBatch()
        source_key = ensure_source(batch, ingestor_name=self.name, source_label=ctx.source_label)
        try:
            data = json.loads(ctx.path.read_text(encoding="utf-8", errors="ignore"))
        except (json.JSONDecodeError, OSError):
            return batch
        if not isinstance(data, dict):
            return batch
        artifact = str(data.get("ArtifactName") or "artifact")

        for res in data.get("Results") or []:
            if not isinstance(res, dict):
                continue
            target = str(res.get("Target") or artifact)
            for vuln in res.get("Vulnerabilities") or []:
                if not isinstance(vuln, dict):
                    continue
                vid = str(vuln.get("VulnerabilityID") or vuln.get("ID") or vuln.get("PkgID") or "")
                title = str(vuln.get("Title") or vid or "Trivy finding")
                sev = str(vuln.get("Severity") or "unknown").lower()
                pkg = str(vuln.get("PkgName") or "")
                ver = str(vuln.get("InstalledVersion") or "")
                primary = str(vuln.get("PrimaryURL") or "")
                ref = primary if primary.startswith("http") else f"pkg:trivy:{target}|{pkg}|{ver}"

                emit_finding_on_target(
                    batch,
                    scanner="trivy",
                    dedup_parts=(vid, target, pkg, ver),
                    target_uri=ref,
                    method="GET",
                    source_label=ctx.source_label,
                    source_key=source_key,
                    finding_props={
                        "scanner": "trivy",
                        "name": title,
                        "severity": sev,
                        "template_id": vid or None,
                        "cve": vid or None,
                        "package": pkg or None,
                        "installed_version": ver or None,
                        "target": target,
                        "primary_url": primary or None,
                    },
                    edge_props={"cve": vid, "package": pkg},
                    endpoint_props={"artifact": artifact},
                )
        return batch


register_ingestor(TrivyJsonIngestor())
