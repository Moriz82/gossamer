from __future__ import annotations

import logging
import re
from collections import deque
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx

from gossamer.config import Settings, get_settings
from gossamer.ingestors.base import Ingestor
from gossamer.ingestors.headers import extract_header_intel
from gossamer.ingestors.registry import register_ingestor
from gossamer.models import IngestContext, RawEdge, RawNode, RawObservationBatch
from gossamer.scope import host_allowed

logger = logging.getLogger(__name__)

_HREF_RE = re.compile(r'href=["\']([^"\']+)["\']', re.I)

# Sentinel path: ingest expects a file; crawl uses a .url seed file (one URL per line)


class CrawlIngestor(Ingestor):
    name = "crawl_seed"

    def can_handle(self, path: Path, mime: str | None = None) -> bool:
        return path.suffix.lower() == ".urlseed"

    def ingest(self, ctx: IngestContext) -> RawObservationBatch:
        batch = RawObservationBatch()
        source_key = f"ingestor:{self.name}:{ctx.source_label}"
        batch.nodes.append(
            RawNode(
                kind="Source",
                key=source_key,
                properties={"name": ctx.source_label, "ingestor": self.name},
                source=ctx.source_label,
            )
        )
        settings = ctx.options.get("settings") or get_settings()
        if not isinstance(settings, Settings):
            settings = get_settings()
        max_depth = int(ctx.options.get("max_depth") or settings.crawl_max_depth)
        max_pages = int(ctx.options.get("max_pages") or settings.crawl_max_pages)
        timeout = float(ctx.options.get("timeout") or settings.crawl_timeout_seconds)
        scope = list(ctx.options.get("scope_hosts") or settings.scope_hosts)

        seeds = [
            ln.strip()
            for ln in ctx.path.read_text(encoding="utf-8", errors="ignore").splitlines()
            if ln.strip() and not ln.strip().startswith("#")
        ]
        visited: set[str] = set()
        queue: deque[tuple[str, int]] = deque((s, 0) for s in seeds)
        initial_cookies = ctx.options.get("cookies") or {}

        limits = httpx.Limits(max_connections=20, max_keepalive_connections=10)
        headers = {"User-Agent": settings.crawl_user_agent}

        logger.info(
            "Crawl starting with %d seeds, max_depth=%d, max_pages=%d",
            len(seeds), max_depth, max_pages,
        )

        with httpx.Client(
            follow_redirects=True,
            timeout=timeout,
            limits=limits,
            headers=headers,
            cookies=initial_cookies,
        ) as client:
            while queue and len(visited) < max_pages:
                url, depth = queue.popleft()
                p = urlparse(url)
                host = (p.hostname or "").lower()
                if not host or not host_allowed(host, scope):
                    continue
                canon = f"{p.scheme}://{host}{p.path or '/'}"
                if p.query:
                    canon += f"?{p.query}"
                if canon in visited:
                    continue
                visited.add(canon)
                logger.debug("Fetching %s (depth=%d)", canon, depth)
                method = "GET"
                ep_key = f"{method}|{canon}"
                host_key = host
                try:
                    resp = client.get(canon)
                    status = resp.status_code
                    ctype = resp.headers.get("content-type", "")
                except httpx.HTTPError:
                    status = None
                    ctype = ""
                    resp = None

                props: dict = {"url": canon, "method": method, "status_code": status}
                if ctype:
                    props["content_type"] = ctype.split(";")[0].strip()

                host_props: dict = {"hostname": host}
                if resp is not None:
                    intel = extract_header_intel(dict(resp.headers))
                    props.update(intel.endpoint_props)
                    if intel.host_tech_hints:
                        host_props.update(intel.host_tech_hints)

                batch.nodes.append(
                    RawNode(
                        kind="Host",
                        key=host_key,
                        properties=host_props,
                        source=ctx.source_label,
                    )
                )
                batch.nodes.append(
                    RawNode(
                        kind="Endpoint",
                        key=ep_key,
                        properties=props,
                        source=ctx.source_label,
                    )
                )
                batch.edges.append(
                    RawEdge(
                        kind="serves",
                        src_kind="Host",
                        src_key=host_key,
                        dst_kind="Endpoint",
                        dst_key=ep_key,
                        properties={"scheme": p.scheme},
                        source=ctx.source_label,
                    )
                )
                batch.edges.append(
                    RawEdge(
                        kind="discovered_by",
                        src_kind="Endpoint",
                        src_key=ep_key,
                        dst_kind="Source",
                        dst_key=source_key,
                        properties={},
                        source=ctx.source_label,
                    )
                )

                if resp is None or depth >= max_depth:
                    continue
                if "text/html" not in ctype.lower() and resp.text and "<a " not in resp.text[:1000].lower():
                    continue
                try:
                    text = resp.text
                except Exception:
                    continue
                for m in _HREF_RE.findall(text):
                    dest = urljoin(canon, m)
                    dp = urlparse(dest)
                    dh = (dp.hostname or "").lower()
                    if not dh or not host_allowed(dh, scope):
                        continue
                    dest_full = dest
                    dest_method = "GET"
                    dest_key = f"{dest_method}|{dest_full}"
                    dh_key = dh
                    batch.nodes.append(
                        RawNode(
                            kind="Host",
                            key=dh_key,
                            properties={"hostname": dh},
                            source=ctx.source_label,
                        )
                    )
                    batch.nodes.append(
                        RawNode(
                            kind="Endpoint",
                            key=dest_key,
                            properties={"url": dest_full, "method": dest_method},
                            source=ctx.source_label,
                        )
                    )
                    batch.edges.append(
                        RawEdge(
                            kind="serves",
                            src_kind="Host",
                            src_key=dh_key,
                            dst_kind="Endpoint",
                            dst_key=dest_key,
                            properties={"scheme": dp.scheme},
                            source=ctx.source_label,
                        )
                    )
                    batch.edges.append(
                        RawEdge(
                            kind="links_to",
                            src_kind="Endpoint",
                            src_key=ep_key,
                            dst_kind="Endpoint",
                            dst_key=dest_key,
                            properties={"via": "href"},
                            source=ctx.source_label,
                        )
                    )
                    queue.append((dest_full, depth + 1))
        logger.info("Crawl complete: %d pages visited", len(visited))
        return batch


register_ingestor(CrawlIngestor())
