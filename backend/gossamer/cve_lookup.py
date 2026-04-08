"""CVE lookup via online APIs with local caching.

Primary: cve.circl.lu (fast, no auth)
Secondary: NVD API via nvdlib (authoritative, rate-limited)
"""
from __future__ import annotations

import logging
import re
import time
from typing import Any

import httpx

from gossamer.cve_cache import CVEEntry, get_cached, store_cached

logger = logging.getLogger(__name__)

# Rate limiting
_last_nvd_call = 0.0
_NVD_INTERVAL = 6.5  # NVD API requires ~6s between requests without API key


def lookup_cves(tech_name: str, version: str = "", cpe: str | None = None) -> list[CVEEntry]:
    """Look up CVEs for a technology+version. Uses cache, then online APIs.

    Args:
        tech_name: Technology name (e.g., "WordPress")
        version: Version string (e.g., "6.2.1")
        cpe: Optional CPE string for precise matching

    Returns:
        List of CVEEntry objects, sorted by severity.
    """
    # Check cache first
    cached = get_cached(tech_name, version)
    if cached is not None:
        return cached

    entries: list[CVEEntry] = []

    # Try circl.lu first (fast, no auth)
    try:
        entries = _lookup_circl(tech_name, version)
    except Exception as e:
        logger.debug("circl.lu lookup failed for %s %s: %s", tech_name, version, e)

    # Fallback to NVD if circl.lu returned nothing and we have a CPE
    if not entries and cpe:
        try:
            entries = _lookup_nvd_cpe(cpe, version)
        except Exception as e:
            logger.debug("NVD lookup failed for %s: %s", cpe, e)

    # Fallback: NVD keyword search
    if not entries and version:
        try:
            entries = _lookup_nvd_keyword(tech_name, version)
        except Exception as e:
            logger.debug("NVD keyword search failed for %s %s: %s", tech_name, version, e)

    # Sort by severity
    sev_order = {"critical": 0, "high": 1, "medium": 2, "low": 3, "unknown": 4}
    entries.sort(key=lambda e: (sev_order.get(e.severity, 4), -(e.cvss_score or 0)))

    # Cache results (even empty list, to avoid repeated lookups)
    store_cached(tech_name, version, entries)

    return entries


def _lookup_circl(tech_name: str, version: str) -> list[CVEEntry]:
    """Query cve.circl.lu API for CVEs matching a technology."""
    # Normalize name for API path
    vendor = _normalize_vendor(tech_name)
    product = _normalize_product(tech_name)

    entries: list[CVEEntry] = []
    with httpx.Client(timeout=15) as client:
        # Try vendor/product search
        url = f"https://cve.circl.lu/api/search/{vendor}/{product}"
        resp = client.get(url)
        if resp.status_code == 200:
            data = resp.json()
            if isinstance(data, list):
                for item in data[:100]:  # Cap at 100
                    entry = _parse_circl_cve(item, version)
                    if entry:
                        entries.append(entry)

    return entries


def _parse_circl_cve(item: dict[str, Any], target_version: str = "") -> CVEEntry | None:
    """Parse a CVE entry from circl.lu response."""
    cve_id = item.get("id", "")
    if not cve_id.startswith("CVE-"):
        return None

    summary = item.get("summary", "")
    cvss = item.get("cvss")
    cvss_score = float(cvss) if cvss else None

    # Determine severity from CVSS
    severity = "unknown"
    if cvss_score is not None:
        if cvss_score >= 9.0:
            severity = "critical"
        elif cvss_score >= 7.0:
            severity = "high"
        elif cvss_score >= 4.0:
            severity = "medium"
        else:
            severity = "low"

    # Check if version is in the affected range
    if target_version:
        vuln_config = item.get("vulnerable_configuration", [])
        vuln_products = item.get("vulnerable_product", [])
        all_cpes = vuln_config + vuln_products
        # If we have CPE data, check version match
        if all_cpes and not _version_in_cpes(target_version, all_cpes):
            return None  # Version not affected

    refs = []
    for ref in item.get("references", []):
        if isinstance(ref, str):
            refs.append(ref)

    # Check for exploit availability
    exploit_available = any(
        "exploit" in r.lower() or "poc" in r.lower() or "github.com" in r.lower()
        for r in refs
    )

    return CVEEntry(
        cve_id=cve_id,
        severity=severity,
        cvss_score=cvss_score,
        description=summary[:500],
        references=refs[:10],
        exploit_available=exploit_available,
    )


def _version_in_cpes(version: str, cpes: list[str]) -> bool:
    """Check if a version might be affected based on CPE strings."""
    if not version:
        return True  # No version to check, assume affected
    v_parts = version.split(".")
    for cpe in cpes:
        if not isinstance(cpe, str):
            continue
        # CPE format: cpe:2.3:a:vendor:product:version:...
        parts = cpe.split(":")
        if len(parts) >= 6:
            cpe_ver = parts[5]
            if cpe_ver in ("*", "-", ""):
                return True  # Wildcard, all versions affected
            if cpe_ver == version:
                return True
            # Check major.minor match
            cv_parts = cpe_ver.split(".")
            if len(v_parts) >= 2 and len(cv_parts) >= 2:
                if v_parts[0] == cv_parts[0] and (v_parts[1] == cv_parts[1] or cv_parts[1] == "*"):
                    return True
    return False


def _lookup_nvd_cpe(cpe: str, version: str = "") -> list[CVEEntry]:
    """Query NVD API by CPE string."""
    global _last_nvd_call
    try:
        import nvdlib
    except ImportError:
        logger.debug("nvdlib not installed, skipping NVD lookup")
        return []

    # Rate limit
    elapsed = time.time() - _last_nvd_call
    if elapsed < _NVD_INTERVAL:
        time.sleep(_NVD_INTERVAL - elapsed)

    # Fill in version in CPE if present
    if version and ":*:" in cpe:
        cpe = cpe.replace(":*:", f":{version}:", 1)

    entries: list[CVEEntry] = []
    try:
        _last_nvd_call = time.time()
        results = nvdlib.searchCVE(cpeName=cpe, limit=50)
        for r in results:
            entry = _parse_nvd_cve(r)
            if entry:
                entries.append(entry)
    except Exception as e:
        logger.debug("NVD CPE search error: %s", e)

    return entries


def _lookup_nvd_keyword(tech_name: str, version: str) -> list[CVEEntry]:
    """Query NVD API by keyword search."""
    global _last_nvd_call
    try:
        import nvdlib
    except ImportError:
        return []

    elapsed = time.time() - _last_nvd_call
    if elapsed < _NVD_INTERVAL:
        time.sleep(_NVD_INTERVAL - elapsed)

    entries: list[CVEEntry] = []
    try:
        _last_nvd_call = time.time()
        keyword = f"{tech_name} {version}"
        results = nvdlib.searchCVE(keywordSearch=keyword, limit=25)
        for r in results:
            entry = _parse_nvd_cve(r)
            if entry:
                entries.append(entry)
    except Exception as e:
        logger.debug("NVD keyword search error: %s", e)

    return entries


def _parse_nvd_cve(result: Any) -> CVEEntry | None:
    """Parse a CVE from nvdlib result object."""
    try:
        cve_id = result.id
        desc = ""
        if hasattr(result, "descriptions"):
            for d in result.descriptions:
                if d.lang == "en":
                    desc = d.value[:500]
                    break

        # Get CVSS score
        cvss_score = None
        severity = "unknown"
        if hasattr(result, "score"):
            scores = result.score
            if scores and len(scores) >= 2:
                cvss_score = scores[1]
                severity = (scores[2] or "unknown").lower() if len(scores) >= 3 else "unknown"

        # Get references
        refs = []
        if hasattr(result, "references"):
            for ref in result.references[:10]:
                refs.append(ref.url)

        exploit_available = any(
            "exploit" in r.lower() or "poc" in r.lower()
            for r in refs
        )

        return CVEEntry(
            cve_id=cve_id,
            severity=severity,
            cvss_score=cvss_score,
            description=desc,
            references=refs,
            exploit_available=exploit_available,
        )
    except Exception:
        return None


def _normalize_vendor(tech_name: str) -> str:
    """Normalize technology name to vendor string for API queries."""
    mapping = {
        "WordPress": "wordpress",
        "Apache HTTP Server": "apache",
        "Nginx": "nginx",
        "PHP": "php",
        "MySQL": "oracle",
        "jQuery": "jquery",
        "Ruby on Rails": "rubyonrails",
        "Node.js": "nodejs",
        "Express": "expressjs",
        "Django": "djangoproject",
        "Flask": "palletsprojects",
        "React": "facebook",
        "Angular": "google",
        "Vue.js": "vuejs",
    }
    return mapping.get(tech_name, re.sub(r"[^a-z0-9]", "", tech_name.lower()))


def _normalize_product(tech_name: str) -> str:
    """Normalize technology name to product string for API queries."""
    mapping = {
        "Apache HTTP Server": "http_server",
        "MySQL": "mysql",
        "PHP": "php",
        "Ruby on Rails": "rails",
        "Node.js": "node.js",
    }
    return mapping.get(tech_name, re.sub(r"[^a-z0-9]", "", tech_name.lower()))
