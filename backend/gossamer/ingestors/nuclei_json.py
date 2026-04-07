from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import urlparse

from gossamer.ingestors.base import Ingestor
from gossamer.ingestors.finding_helpers import emit_finding_on_target, ensure_source
from gossamer.ingestors.registry import register_ingestor
from gossamer.models import IngestContext, RawObservationBatch


def _host_from_url(url: str) -> str:
    p = urlparse(url)
    return (p.hostname or "").lower()


def _is_nuclei_sample(text: str) -> bool:
    tl = text[:8192]
    return '"template-id"' in tl or "'template-id'" in tl or '"template_id"' in tl


class NucleiJsonIngestor(Ingestor):
    name = "nuclei_json"

    def can_handle(self, path: Path, mime: str | None = None) -> bool:
        suf = path.suffix.lower()
        if suf in (".jsonl", ".ndjson"):
            try:
                return _is_nuclei_sample(path.read_text(encoding="utf-8", errors="ignore"))
            except OSError:
                return False
        if suf == ".json":
            try:
                raw = path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                return False
            if _is_nuclei_sample(raw):
                return True
            stripped = raw.lstrip()[:2048]
            if stripped.startswith("["):
                return '"template-id"' in stripped or '"template_id"' in stripped
        return False

    def ingest(self, ctx: IngestContext) -> RawObservationBatch:
        batch = RawObservationBatch()
        source_key = ensure_source(batch, ingestor_name=self.name, source_label=ctx.source_label)

        raw = ctx.path.read_text(encoding="utf-8", errors="ignore")
        records: list[dict] = []
        path_suffix = ctx.path.suffix.lower()
        if path_suffix in (".jsonl", ".ndjson"):
            for line in raw.splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    records.append(json.loads(line))
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
            tid = str(obj.get("template-id") or obj.get("template_id") or "").strip()
            if not tid:
                continue
            info = obj.get("info") if isinstance(obj.get("info"), dict) else {}
            name = str(info.get("name") or obj.get("name") or tid)
            severity = str(info.get("severity") or obj.get("severity") or "unknown").lower()
            tags = info.get("tags") or []
            if not isinstance(tags, list):
                tags = [tags] if tags else []
            tags = [str(t) for t in tags]
            matched = str(obj.get("matched-at") or obj.get("matched_at") or "").strip()
            host = str(obj.get("host") or "").strip()
            url = matched or host
            if not url or not _host_from_url(url):
                continue
            method = str(obj.get("method") or "GET")
            matcher = str(obj.get("matcher-name") or obj.get("matcher_name") or "")
            desc = info.get("description")
            emit_finding_on_target(
                batch,
                scanner="nuclei",
                dedup_parts=(tid, matcher, matched or url, name),
                target_uri=url,
                method=method,
                source_label=ctx.source_label,
                source_key=source_key,
                finding_props={
                    "scanner": "nuclei",
                    "template_id": tid,
                    "name": name,
                    "severity": severity,
                    "matcher_name": matcher,
                    "matched_at": matched or None,
                    "host": host or None,
                    "tags": tags,
                    "description": desc if isinstance(desc, str) else None,
                },
                edge_props={"matcher_name": matcher, "template_id": tid},
            )

        return batch


register_ingestor(NucleiJsonIngestor())
