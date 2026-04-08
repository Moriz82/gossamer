"""Wappalyzer-compatible technology fingerprinting engine.

Parses the Wappalyzer fingerprint database and matches HTTP responses
against known technology signatures. Zero extra HTTP requests needed —
works with data the crawler already has (headers, body, cookies, URL).
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_BUNDLED_DB = Path(__file__).parent / "fingerprints" / "technologies.json"
_USER_DB = Path.home() / ".gossamer" / "fingerprints" / "technologies.json"


@dataclass
class TechMatch:
    name: str
    version: str | None = None
    confidence: int = 100
    categories: list[int] = field(default_factory=list)
    cpe: str | None = None
    website: str | None = None
    evidence: list[str] = field(default_factory=list)


def _parse_pattern(raw: str) -> tuple[re.Pattern, str | None, int]:
    """Parse a Wappalyzer pattern string into (regex, version_group, confidence).

    Format: "pattern\\;version:\\1\\;confidence:80"
    """
    parts = raw.split("\\;")
    pattern_str = parts[0]
    version_group = None
    confidence = 100

    for part in parts[1:]:
        if part.startswith("version:"):
            version_group = part[8:]  # e.g., "\\1" -> version from capture group 1
        elif part.startswith("confidence:"):
            try:
                confidence = int(part[11:])
            except ValueError:
                pass

    try:
        regex = re.compile(pattern_str, re.IGNORECASE)
    except re.error:
        regex = re.compile(re.escape(pattern_str), re.IGNORECASE)

    return regex, version_group, confidence


def _extract_version(match: re.Match, version_tpl: str | None) -> str | None:
    """Extract version string from regex match using Wappalyzer's version template."""
    if not version_tpl or not match:
        return None
    result = version_tpl
    for i in range(10):
        placeholder = f"\\{i}"
        if placeholder in result:
            try:
                group_val = match.group(i) or ""
                result = result.replace(placeholder, group_val)
            except IndexError:
                result = result.replace(placeholder, "")
    result = result.strip()
    return result if result else None


class FingerprintDB:
    """In-memory Wappalyzer fingerprint database with compiled regexes."""

    def __init__(self) -> None:
        self._techs: dict[str, dict[str, Any]] = {}
        self._compiled: dict[str, dict[str, Any]] = {}
        self._loaded = False

    def load(self, path: Path | None = None) -> None:
        """Load fingerprint database from JSON file."""
        if path and path.is_file():
            db_path = path
        elif _USER_DB.is_file():
            db_path = _USER_DB
        elif _BUNDLED_DB.is_file():
            db_path = _BUNDLED_DB
        else:
            logger.warning("No fingerprint database found")
            return

        try:
            data = json.loads(db_path.read_text(encoding="utf-8"))
            self._techs = data.get("apps", data)
            self._compile_all()
            self._loaded = True
            logger.info("Loaded %d technology fingerprints from %s", len(self._techs), db_path)
        except Exception as e:
            logger.error("Failed to load fingerprint DB: %s", e)

    def _compile_all(self) -> None:
        """Pre-compile all regex patterns for fast matching."""
        for name, entry in self._techs.items():
            compiled: dict[str, Any] = {
                "headers": {},
                "cookies": {},
                "meta": {},
                "html": [],
                "scripts": [],
                "url": [],
                "implies": [],
                "cats": entry.get("cats", []),
                "cpe": entry.get("cpe"),
                "website": entry.get("website"),
            }

            # Headers: {"header_name": "pattern"}
            for hdr, pat in (entry.get("headers") or {}).items():
                if isinstance(pat, str):
                    compiled["headers"][hdr.lower()] = [_parse_pattern(pat)]
                elif isinstance(pat, list):
                    compiled["headers"][hdr.lower()] = [_parse_pattern(p) for p in pat]

            # Cookies: {"cookie_name": "pattern"}
            for ck, pat in (entry.get("cookies") or {}).items():
                if isinstance(pat, str):
                    compiled["cookies"][ck.lower()] = _parse_pattern(pat) if pat else (None, None, 100)

            # Meta tags: {"meta_name": ["pattern", ...] or "pattern"}
            for meta_name, pats in (entry.get("meta") or {}).items():
                if isinstance(pats, str):
                    pats = [pats]
                compiled["meta"][meta_name.lower()] = [_parse_pattern(p) for p in pats if p]

            # HTML body patterns
            for pat in _as_list(entry.get("html")):
                if pat:
                    compiled["html"].append(_parse_pattern(pat))

            # Script src patterns
            for pat in _as_list(entry.get("scriptSrc")) + _as_list(entry.get("scripts")):
                if pat:
                    compiled["scripts"].append(_parse_pattern(pat))

            # URL patterns
            for pat in _as_list(entry.get("url")):
                if pat:
                    compiled["url"].append(_parse_pattern(pat))

            # Implies
            for imp in _as_list(entry.get("implies")):
                if isinstance(imp, str):
                    # Parse "PHP\\;confidence:50"
                    parts = imp.split("\\;")
                    imp_name = parts[0]
                    imp_conf = 100
                    for p in parts[1:]:
                        if p.startswith("confidence:"):
                            try:
                                imp_conf = int(p[11:])
                            except ValueError:
                                pass
                    compiled["implies"].append((imp_name, imp_conf))

            self._compiled[name] = compiled

    @property
    def loaded(self) -> bool:
        return self._loaded

    @property
    def tech_count(self) -> int:
        return len(self._compiled)


def _as_list(val: Any) -> list:
    if val is None:
        return []
    if isinstance(val, list):
        return val
    return [val]


# ── Global singleton ──
_db = FingerprintDB()


def get_db() -> FingerprintDB:
    if not _db.loaded:
        _db.load()
    return _db


def fingerprint_response(
    url: str,
    headers: dict[str, str],
    body: str | None = None,
    cookies: dict[str, str] | None = None,
) -> list[TechMatch]:
    """Match an HTTP response against the fingerprint database.

    Args:
        url: The request URL
        headers: Response headers (case-insensitive keys)
        body: Response body (HTML)
        cookies: Cookies from Set-Cookie headers

    Returns:
        List of matched technologies with version and confidence info.
    """
    db = get_db()
    if not db.loaded:
        return []

    lh = {k.lower(): v for k, v in headers.items()}
    lc = {k.lower(): v for k, v in (cookies or {}).items()}

    # Extract meta tags from body
    meta_tags: dict[str, str] = {}
    if body:
        for m in re.finditer(
            r'<meta\s+[^>]*?name=["\']([^"\']+)["\'][^>]*?content=["\']([^"\']*)["\']',
            body[:50000], re.IGNORECASE,
        ):
            meta_tags[m.group(1).lower()] = m.group(2)
        # Also match content before name
        for m in re.finditer(
            r'<meta\s+[^>]*?content=["\']([^"\']*)["\'][^>]*?name=["\']([^"\']+)["\']',
            body[:50000], re.IGNORECASE,
        ):
            meta_tags[m.group(2).lower()] = m.group(1)

    # Extract script src from body
    script_srcs: list[str] = []
    if body:
        for m in re.finditer(r'<script[^>]+src=["\']([^"\']+)["\']', body[:100000], re.IGNORECASE):
            script_srcs.append(m.group(1))

    matches: dict[str, TechMatch] = {}

    for name, comp in db._compiled.items():
        confidence = 0
        version = None
        evidence: list[str] = []

        # Check headers — only match if header is actually present
        for hdr_name, patterns in comp["headers"].items():
            hdr_val = lh.get(hdr_name)
            if hdr_val is None:
                continue  # Header not present, skip
            for regex, ver_tpl, conf in patterns:
                if regex is None or regex.pattern == "":
                    # Empty pattern = just check header exists
                    confidence = max(confidence, conf)
                    evidence.append(f"header:{hdr_name}")
                else:
                    m = regex.search(hdr_val)
                    if m:
                        confidence = max(confidence, conf)
                        evidence.append(f"header:{hdr_name}={hdr_val[:60]}")
                        v = _extract_version(m, ver_tpl)
                        if v:
                            version = v

        # Check cookies
        for ck_name, parsed in comp["cookies"].items():
            if ck_name in lc:
                if parsed is None or parsed[0] is None:
                    confidence = max(confidence, 100)
                    evidence.append(f"cookie:{ck_name}")
                else:
                    regex, ver_tpl, conf = parsed
                    m = regex.search(lc[ck_name])
                    if m:
                        confidence = max(confidence, conf)
                        evidence.append(f"cookie:{ck_name}")
                        v = _extract_version(m, ver_tpl)
                        if v:
                            version = v

        # Check meta tags — only match if tag is present
        for meta_name, patterns in comp["meta"].items():
            meta_val = meta_tags.get(meta_name)
            if meta_val is None:
                continue
            for regex, ver_tpl, conf in patterns:
                if regex is None:
                    if meta_val:
                        confidence = max(confidence, conf)
                        evidence.append(f"meta:{meta_name}")
                else:
                    m = regex.search(meta_val)
                    if m:
                        confidence = max(confidence, conf)
                        evidence.append(f"meta:{meta_name}={meta_val[:60]}")
                        v = _extract_version(m, ver_tpl)
                        if v:
                            version = v

        # Check HTML patterns
        if body and comp["html"]:
            for regex, ver_tpl, conf in comp["html"]:
                m = regex.search(body[:100000])
                if m:
                    confidence = max(confidence, conf)
                    evidence.append("html:body_match")
                    v = _extract_version(m, ver_tpl)
                    if v:
                        version = v
                    break  # One HTML match is enough

        # Check script src patterns
        if script_srcs and comp["scripts"]:
            for regex, ver_tpl, conf in comp["scripts"]:
                for src in script_srcs:
                    m = regex.search(src)
                    if m:
                        confidence = max(confidence, conf)
                        evidence.append(f"script:{src[:60]}")
                        v = _extract_version(m, ver_tpl)
                        if v:
                            version = v
                        break

        # Check URL patterns
        if comp["url"]:
            for regex, ver_tpl, conf in comp["url"]:
                m = regex.search(url)
                if m:
                    confidence = max(confidence, conf)
                    evidence.append(f"url:{url[:60]}")
                    v = _extract_version(m, ver_tpl)
                    if v:
                        version = v

        if confidence > 0:
            matches[name] = TechMatch(
                name=name,
                version=version,
                confidence=confidence,
                categories=comp["cats"],
                cpe=comp["cpe"],
                website=comp["website"],
                evidence=evidence,
            )

    # Resolve implies
    added = True
    while added:
        added = False
        for name in list(matches.keys()):
            comp = db._compiled.get(name, {})
            for imp_name, imp_conf in comp.get("implies", []):
                if imp_name not in matches and imp_name in db._compiled:
                    matches[imp_name] = TechMatch(
                        name=imp_name,
                        confidence=imp_conf,
                        categories=db._compiled[imp_name].get("cats", []),
                        cpe=db._compiled[imp_name].get("cpe"),
                        website=db._compiled[imp_name].get("website"),
                        evidence=[f"implied_by:{name}"],
                    )
                    added = True

    return sorted(matches.values(), key=lambda t: (-t.confidence, t.name))
