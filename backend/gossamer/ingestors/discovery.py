"""Pre-crawl discovery via robots.txt and sitemap.xml."""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

import httpx

try:
    from defusedxml import ElementTree as ET
except ImportError:
    from xml.etree import ElementTree as ET  # type: ignore[no-redef]

logger = logging.getLogger(__name__)


@dataclass
class DiscoveryResult:
    disallowed_paths: list[str] = field(default_factory=list)
    sitemap_urls: list[str] = field(default_factory=list)


def discover_from_robots(client: httpx.Client, base_url: str) -> DiscoveryResult:
    """Fetch and parse /robots.txt for Sitemap directives and Disallow rules."""
    result = DiscoveryResult()
    robots_url = f"{base_url.rstrip('/')}/robots.txt"
    try:
        resp = client.get(robots_url, follow_redirects=True)
        if resp.status_code != 200:
            return result
        for line in resp.text.splitlines():
            line = line.strip()
            if line.lower().startswith("sitemap:"):
                sm_url = line.split(":", 1)[1].strip()
                if sm_url:
                    result.sitemap_urls.append(sm_url)
            elif line.lower().startswith("disallow:"):
                path = line.split(":", 1)[1].strip()
                if path:
                    result.disallowed_paths.append(path)
    except (httpx.TimeoutException, httpx.NetworkError) as exc:
        logger.debug("Failed to fetch robots.txt from %s: %s", base_url, exc)
    return result


def discover_from_sitemap(
    client: httpx.Client, sitemap_url: str, *, max_urls: int = 500
) -> list[str]:
    """Parse sitemap.xml (handles both urlset and sitemapindex)."""
    urls: list[str] = []
    try:
        resp = client.get(sitemap_url, follow_redirects=True)
        if resp.status_code != 200:
            return urls
        root = ET.fromstring(resp.text)
        # Strip namespace for easier matching
        ns_match = re.match(r"\{.*\}", root.tag)
        ns_prefix = ns_match.group(0) if ns_match else ""

        # Check if sitemapindex — recurse into sub-sitemaps
        for sitemap in root.iter(f"{ns_prefix}sitemap"):
            loc = sitemap.find(f"{ns_prefix}loc")
            if loc is not None and loc.text and len(urls) < max_urls:
                sub_urls = discover_from_sitemap(
                    client, loc.text.strip(), max_urls=max_urls - len(urls)
                )
                urls.extend(sub_urls)

        # Parse urlset entries
        for url_elem in root.iter(f"{ns_prefix}url"):
            loc = url_elem.find(f"{ns_prefix}loc")
            if loc is not None and loc.text:
                urls.append(loc.text.strip())
                if len(urls) >= max_urls:
                    break
    except (httpx.TimeoutException, httpx.NetworkError) as exc:
        logger.debug("Failed to fetch sitemap %s: %s", sitemap_url, exc)
    except ET.ParseError as exc:
        logger.debug("Failed to parse sitemap %s: %s", sitemap_url, exc)
    return urls
