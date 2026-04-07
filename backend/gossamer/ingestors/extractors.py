"""Comprehensive link extraction from HTML, JavaScript, and JSON responses."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from urllib.parse import urljoin


@dataclass
class ExtractedLink:
    url: str
    via: str  # "href", "src", "action", "meta_refresh", "js_url", "json_url", "srcset"
    method: str  # "GET" for most; "POST" for form actions with method=POST
    context: str  # "a.href", "script.src", "form.action", "img.srcset", etc.


# HTML patterns
_A_HREF = re.compile(r'<a\s[^>]*?href=["\']([^"\']+)["\']', re.I)
_SCRIPT_SRC = re.compile(r'<script\s[^>]*?src=["\']([^"\']+)["\']', re.I)
_LINK_HREF = re.compile(r'<link\s[^>]*?href=["\']([^"\']+)["\']', re.I)
_IMG_SRC = re.compile(r'<img\s[^>]*?src=["\']([^"\']+)["\']', re.I)
_IFRAME_SRC = re.compile(r'<iframe\s[^>]*?src=["\']([^"\']+)["\']', re.I)
_FORM_ACTION = re.compile(r'<form\s[^>]*?action=["\']([^"\']+)["\']', re.I)
_FORM_METHOD = re.compile(r'<form\s[^>]*?method=["\']([^"\']+)["\']', re.I)
_META_REFRESH = re.compile(
    r'<meta\s[^>]*?content=["\'][^"\']*url=([^"\';\s]+)', re.I
)
_SRCSET = re.compile(r'srcset=["\']([^"\']+)["\']', re.I)
_AREA_HREF = re.compile(r'<area\s[^>]*?href=["\']([^"\']+)["\']', re.I)
_DATA_URL = re.compile(r'data-(?:url|href)=["\']([^"\']+)["\']', re.I)
_EMBED_SRC = re.compile(
    r'<(?:embed|source)\s[^>]*?src=["\']([^"\']+)["\']', re.I
)

# JavaScript patterns
_JS_URL_LITERAL = re.compile(r'''["'](https?://[^"'\s]{5,})["']''')
_JS_FETCH = re.compile(
    r'''(?:fetch|axios\.get|axios\.post|axios)\s*\(\s*["']([^"']+)["']''', re.I
)
_JS_XHR = re.compile(
    r'''\.open\s*\(\s*["'][A-Z]+["']\s*,\s*["']([^"']+)["']''', re.I
)
_JS_LOCATION = re.compile(
    r'''(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']'''
)
_JS_API_PATH = re.compile(r'''["'](\/(?:api|v[0-9])[^"'\s]*)["']''')


_HTML_SIMPLE_PATTERNS: list[tuple[re.Pattern[str], str, str]] = [
    (_A_HREF, "href", "a.href"),
    (_SCRIPT_SRC, "src", "script.src"),
    (_LINK_HREF, "href", "link.href"),
    (_IMG_SRC, "src", "img.src"),
    (_IFRAME_SRC, "src", "iframe.src"),
    (_AREA_HREF, "href", "area.href"),
    (_EMBED_SRC, "src", "embed.src"),
    (_DATA_URL, "href", "data-url"),
]


def extract_links_html(html: str, base_url: str) -> list[ExtractedLink]:
    """Extract URLs from HTML attributes."""
    links: list[ExtractedLink] = []

    for pattern, via, context in _HTML_SIMPLE_PATTERNS:
        for m in pattern.finditer(html):
            links.append(
                ExtractedLink(urljoin(base_url, m.group(1)), via, "GET", context)
            )

    # Form actions -- the _FORM_ACTION regex already anchors at <form,
    # so the tag text runs from m.start() to the closing >.
    for m in _FORM_ACTION.finditer(html):
        tag_end = html.find(">", m.end())
        form_tag = html[m.start() : tag_end + 1 if tag_end >= 0 else m.end()]
        method_m = _FORM_METHOD.search(form_tag)
        method = method_m.group(1).upper() if method_m else "GET"
        links.append(
            ExtractedLink(
                urljoin(base_url, m.group(1)), "action", method, "form.action"
            )
        )

    # Meta refresh
    for m in _META_REFRESH.finditer(html):
        links.append(
            ExtractedLink(
                urljoin(base_url, m.group(1)), "meta_refresh", "GET", "meta.refresh"
            )
        )

    # Srcset
    for m in _SRCSET.finditer(html):
        for entry in m.group(1).split(","):
            parts = entry.strip().split()
            if parts:
                links.append(
                    ExtractedLink(
                        urljoin(base_url, parts[0]), "srcset", "GET", "img.srcset"
                    )
                )

    return links


def extract_links_javascript(js_text: str, base_url: str) -> list[ExtractedLink]:
    """Extract URL-like strings from JavaScript."""
    links: list[ExtractedLink] = []
    seen: set[str] = set()

    for pattern, via, context in [
        (_JS_FETCH, "js_url", "fetch"),
        (_JS_XHR, "js_url", "xhr.open"),
        (_JS_LOCATION, "js_url", "location"),
        (_JS_API_PATH, "js_url", "api_path"),
        (_JS_URL_LITERAL, "js_url", "url_literal"),
    ]:
        for m in pattern.finditer(js_text):
            url = m.group(1)
            resolved = urljoin(base_url, url)
            if resolved not in seen:
                seen.add(resolved)
                links.append(ExtractedLink(resolved, via, "GET", context))

    return links


def extract_links_json(json_text: str, base_url: str) -> list[ExtractedLink]:
    """Walk JSON values looking for URL-like strings."""
    links: list[ExtractedLink] = []
    try:
        data = json.loads(json_text)
    except (json.JSONDecodeError, ValueError):
        return links

    seen: set[str] = set()
    _walk_json(data, base_url, links, seen)
    return links


_MAX_JSON_DEPTH = 64


def _walk_json(
    obj: object,
    base_url: str,
    links: list[ExtractedLink],
    seen: set[str],
    depth: int = 0,
) -> None:
    if depth > _MAX_JSON_DEPTH:
        return
    if isinstance(obj, str):
        if obj.startswith(("http://", "https://", "/")):
            resolved = urljoin(base_url, obj)
            if resolved not in seen:
                seen.add(resolved)
                links.append(
                    ExtractedLink(resolved, "json_url", "GET", "json_value")
                )
    elif isinstance(obj, dict):
        for v in obj.values():
            _walk_json(v, base_url, links, seen, depth + 1)
    elif isinstance(obj, list):
        for item in obj:
            _walk_json(item, base_url, links, seen, depth + 1)


def extract_all(
    body: str, content_type: str, base_url: str
) -> list[ExtractedLink]:
    """Dispatch to appropriate extractor based on content_type."""
    ct = content_type.lower()
    if "text/html" in ct or "application/xhtml" in ct:
        return extract_links_html(body, base_url)
    elif "javascript" in ct:
        return extract_links_javascript(body, base_url)
    elif "json" in ct:
        return extract_links_json(body, base_url)
    return []
