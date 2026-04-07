"""Response header analysis for security and technology fingerprinting."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

_SECURITY_HEADERS = {
    "content-security-policy",
    "x-frame-options",
    "x-content-type-options",
    "strict-transport-security",
    "x-xss-protection",
    "permissions-policy",
    "referrer-policy",
}

_TECH_HEADERS = {
    "server",
    "x-powered-by",
    "x-aspnet-version",
    "x-generator",
    "x-drupal-cache",
    "x-varnish",
    "via",
}


@dataclass
class HeaderIntel:
    endpoint_props: dict[str, Any] = field(default_factory=dict)
    host_tech_hints: dict[str, Any] = field(default_factory=dict)
    security_flags: list[str] = field(default_factory=list)


def extract_header_intel(headers: dict[str, str]) -> HeaderIntel:
    """Analyze response headers for security and tech indicators."""
    intel = HeaderIntel()
    lower_headers = {k.lower(): v for k, v in headers.items()}

    for hdr in _SECURITY_HEADERS:
        val = lower_headers.get(hdr)
        safe_key = f"hdr_{hdr.replace('-', '_')}"
        if val:
            intel.endpoint_props[safe_key] = val[:500]  # cap length

    if "strict-transport-security" not in lower_headers:
        intel.security_flags.append("missing_hsts")
    if "content-security-policy" not in lower_headers:
        intel.security_flags.append("missing_csp")
    if "x-frame-options" not in lower_headers:
        intel.security_flags.append("missing_x_frame_options")
    if "x-content-type-options" not in lower_headers:
        intel.security_flags.append("missing_x_content_type_options")

    if intel.security_flags:
        intel.endpoint_props["security_flags"] = intel.security_flags

    for hdr in _TECH_HEADERS:
        val = lower_headers.get(hdr)
        if val:
            safe_key = hdr.replace("-", "_")
            intel.host_tech_hints[safe_key] = val[:200]

    cors = lower_headers.get("access-control-allow-origin")
    if cors:
        intel.endpoint_props["hdr_cors_origin"] = cors

    if "set-cookie" in lower_headers:
        intel.endpoint_props["sets_cookies"] = True

    return intel
