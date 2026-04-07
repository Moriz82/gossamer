from __future__ import annotations

import json
from pathlib import Path

from gossamer.ingestors.base import Ingestor
from gossamer.ingestors.finding_helpers import emit_finding_on_target, ensure_source
from gossamer.ingestors.registry import register_ingestor
from gossamer.models import IngestContext, RawObservationBatch


class TrufflehogJsonIngestor(Ingestor):
    name = "trufflehog_json"

    def can_handle(self, path: Path, mime: str | None = None) -> bool:
        suf = path.suffix.lower()
        if suf not in (".json", ".jsonl", ".ndjson"):
            return False
        try:
            head = path.read_text(encoding="utf-8", errors="ignore")[:6000]
        except OSError:
            return False
        return "DetectorName" in head or "detector_name" in head

    def ingest(self, ctx: IngestContext) -> RawObservationBatch:
        batch = RawObservationBatch()
        source_key = ensure_source(batch, ingestor_name=self.name, source_label=ctx.source_label)
        raw = ctx.path.read_text(encoding="utf-8", errors="ignore")
        records: list[dict] = []
        suf = ctx.path.suffix.lower()
        if suf in (".jsonl", ".ndjson"):
            for line in raw.splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                    if isinstance(obj, dict):
                        records.append(obj)
                except json.JSONDecodeError:
                    continue
        else:
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                return batch
            if isinstance(parsed, list):
                records = [x for x in parsed if isinstance(x, dict)]
            elif isinstance(parsed, dict):
                records = [parsed]

        for obj in records:
            det = str(obj.get("DetectorName") or obj.get("detector_name") or "")
            raw_secret = str(obj.get("Raw") or obj.get("raw") or "")[:200]
            verified = obj.get("Verified")
            sm = obj.get("SourceMetadata") or {}
            if not isinstance(sm, dict):
                sm = {}
            data = sm.get("Data") if isinstance(sm.get("Data"), dict) else {}
            if not isinstance(data, dict):
                data = {}
            fs = data.get("Filesystem") if isinstance(data.get("Filesystem"), dict) else {}
            fp = str(fs.get("file") or fs.get("path") or data.get("path") or "")
            ref = ""
            if fp:
                ref = f"file://{fp.lstrip('/')}"
            elif raw_secret.startswith("http://") or raw_secret.startswith("https://"):
                ref = raw_secret.split("\n")[0].strip()[:2000]
            else:
                ref = f"pkg:trufflehog:{det or 'unknown'}"
            if not ref:
                continue

            emit_finding_on_target(
                batch,
                scanner="trufflehog",
                dedup_parts=(det, raw_secret[:80], fp),
                target_uri=ref,
                method="GET",
                source_label=ctx.source_label,
                source_key=source_key,
                finding_props={
                    "scanner": "trufflehog",
                    "name": f"{det} — credential / secret",
                    "severity": "high" if verified else "medium",
                    "template_id": det or None,
                    "detector": det or None,
                    "verified": verified,
                    "file_path": fp or None,
                },
                edge_props={"detector": det},
            )
        return batch


register_ingestor(TrufflehogJsonIngestor())
