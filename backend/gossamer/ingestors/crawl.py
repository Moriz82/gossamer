from __future__ import annotations

import json
import logging
from collections import deque
from pathlib import Path
from urllib.parse import urlparse

import httpx

from gossamer.config import Settings, get_settings
from gossamer.ingestors.base import Ingestor
from gossamer.ingestors.discovery import discover_from_robots, discover_from_sitemap
from gossamer.ingestors.extractors import extract_all
from gossamer.ingestors.fetch import fetch_url
from gossamer.ingestors.forms import extract_forms
from gossamer.ingestors.headers import extract_header_intel
from gossamer.ingestors.registry import register_ingestor
from gossamer.models import IngestContext, RawEdge, RawNode, RawObservationBatch
from gossamer.scope import host_allowed

logger = logging.getLogger(__name__)

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

        disallowed: set[str] = set()

        logger.info(
            "Crawl starting with %d seeds, max_depth=%d, max_pages=%d",
            len(seeds), max_depth, max_pages,
        )

        with httpx.Client(
            follow_redirects=False,
            timeout=timeout,
            limits=limits,
            headers=headers,
            cookies=initial_cookies,
        ) as client:
            # Pre-discovery phase: robots.txt + sitemap.xml
            if settings.crawl_parse_sitemaps or settings.crawl_respect_robots:
                seen_hosts: set[str] = set()
                for seed_url in seeds:
                    sp = urlparse(seed_url)
                    seed_host = (sp.hostname or "").lower()
                    if seed_host in seen_hosts:
                        continue
                    seen_hosts.add(seed_host)
                    base = f"{sp.scheme}://{seed_host}"
                    robots = discover_from_robots(client, base)
                    if settings.crawl_respect_robots:
                        disallowed.update(robots.disallowed_paths)
                    if settings.crawl_parse_sitemaps:
                        sm_sources = robots.sitemap_urls
                        if not sm_sources:
                            sm_sources = [f"{base}/sitemap.xml"]
                        for sm_url in sm_sources:
                            sm_urls = discover_from_sitemap(
                                client, sm_url, max_urls=max_pages - len(queue)
                            )
                            for u in sm_urls:
                                up = urlparse(u)
                                uh = (up.hostname or "").lower()
                                if host_allowed(uh, scope):
                                    queue.append((u, 1))

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
                if disallowed:
                    if any((p.path or "/").startswith(d) for d in disallowed):
                        continue
                visited.add(canon)
                logger.debug("Fetching %s (depth=%d)", canon, depth)
                method = "GET"
                ep_key = f"{method}|{canon}"
                host_key = host

                result = fetch_url(client, canon, max_retries=settings.crawl_max_retries)
                status = result.status_code
                ctype = result.content_type

                props: dict = {"url": canon, "method": method, "status_code": status}
                if ctype:
                    props["content_type"] = ctype.split(";")[0].strip()

                host_props: dict = {"hostname": host}
                if result.headers:
                    intel = extract_header_intel(result.headers)
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

                # Emit redirect chain: src[0] -> src[1] -> ... -> final_url
                if result.redirect_chain:
                    chain_urls = [u for u, _ in result.redirect_chain]
                    chain_statuses = [s for _, s in result.redirect_chain]
                    destinations = chain_urls[1:] + [result.url]
                    for i, dest_url in enumerate(destinations):
                        src_redirect_key = f"{method}|{chain_urls[i]}"
                        dp = urlparse(dest_url)
                        dh = (dp.hostname or "").lower()
                        dest_redirect_key = f"{method}|{dest_url}"
                        if dh:
                            batch.nodes.append(
                                RawNode(
                                    kind="Host",
                                    key=dh,
                                    properties={"hostname": dh},
                                    source=ctx.source_label,
                                )
                            )
                            batch.nodes.append(
                                RawNode(
                                    kind="Endpoint",
                                    key=dest_redirect_key,
                                    properties={"url": dest_url, "method": method},
                                    source=ctx.source_label,
                                )
                            )
                            batch.edges.append(
                                RawEdge(
                                    kind="serves",
                                    src_kind="Host",
                                    src_key=dh,
                                    dst_kind="Endpoint",
                                    dst_key=dest_redirect_key,
                                    properties={"scheme": dp.scheme},
                                    source=ctx.source_label,
                                )
                            )
                        batch.edges.append(
                            RawEdge(
                                kind="redirects_to",
                                src_kind="Endpoint",
                                src_key=src_redirect_key,
                                dst_kind="Endpoint",
                                dst_key=dest_redirect_key,
                                properties={"status_code": chain_statuses[i]},
                                source=ctx.source_label,
                            )
                        )

                if result.error is not None or depth >= max_depth:
                    continue
                body = result.body
                if body is None:
                    continue
                for link in extract_all(body, ctype, result.url):
                    dest = link.url
                    dp = urlparse(dest)
                    dh = (dp.hostname or "").lower()
                    if not dh or not host_allowed(dh, scope):
                        continue
                    dest_full = dest
                    dest_method = link.method
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
                            properties={"via": link.via, "context": link.context},
                            source=ctx.source_label,
                        )
                    )
                    queue.append((dest_full, depth + 1))

                # --- Form extraction ---
                if "text/html" in ctype.lower():
                    for form in extract_forms(body, canon):
                        form_key = f"form|{form.method}|{form.action_url}"
                        batch.nodes.append(
                            RawNode(
                                kind="Form",
                                key=form_key,
                                properties={
                                    "action_url": form.action_url,
                                    "method": form.method,
                                    "input_fields": json.dumps(form.input_fields),
                                    "enctype": form.enctype,
                                    "form_id": form.form_id or "",
                                },
                                source=ctx.source_label,
                            )
                        )
                        batch.edges.append(
                            RawEdge(
                                kind="contains_form",
                                src_kind="Endpoint",
                                src_key=ep_key,
                                dst_kind="Form",
                                dst_key=form_key,
                                properties={},
                                source=ctx.source_label,
                            )
                        )
                        action_ep_key = f"{form.method}|{form.action_url}"
                        batch.nodes.append(
                            RawNode(
                                kind="Endpoint",
                                key=action_ep_key,
                                properties={"url": form.action_url, "method": form.method},
                                source=ctx.source_label,
                            )
                        )
                        batch.edges.append(
                            RawEdge(
                                kind="submits_to",
                                src_kind="Form",
                                src_key=form_key,
                                dst_kind="Endpoint",
                                dst_key=action_ep_key,
                                properties={},
                                source=ctx.source_label,
                            )
                        )
        logger.info("Crawl complete: %d pages visited", len(visited))
        return batch


register_ingestor(CrawlIngestor())
