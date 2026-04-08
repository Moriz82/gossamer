"""Suggestions engine — cross-references graph data to surface interesting attack surface points.

Queries the graph for patterns like:
- Technologies with known CVEs
- Sensitive paths (.git, .env, /admin)
- Login/registration/upload forms
- Missing security headers
- Outdated software
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class Suggestion:
    id: str
    priority: str  # critical, high, medium, low, info
    category: str  # cve, config, exposure, action, tech
    title: str
    detail: str
    evidence: list[str] = field(default_factory=list)
    actions: list[dict[str, str]] = field(default_factory=list)
    related_nodes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "priority": self.priority,
            "category": self.category,
            "title": self.title,
            "detail": self.detail,
            "evidence": self.evidence,
            "actions": self.actions,
            "related_nodes": self.related_nodes,
        }


def generate_suggestions(conn: Any) -> list[Suggestion]:
    """Generate all suggestions from current graph state.

    Args:
        conn: SQLite connection to the graph database.

    Returns:
        Sorted list of suggestions (critical first).
    """
    suggestions: list[Suggestion] = []

    suggestions.extend(_tech_cve_suggestions(conn))
    suggestions.extend(_sensitive_path_suggestions(conn))
    suggestions.extend(_form_suggestions(conn))
    suggestions.extend(_security_header_suggestions(conn))
    suggestions.extend(_tech_specific_suggestions(conn))
    suggestions.extend(_exposure_suggestions(conn))

    # Sort by priority
    prio = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
    suggestions.sort(key=lambda s: (prio.get(s.priority, 4), s.title))

    return suggestions


# ── Rule: Technologies with known CVEs ──

def _tech_cve_suggestions(conn: Any) -> list[Suggestion]:
    results: list[Suggestion] = []
    rows = conn.execute(
        "SELECT id, key, properties_json FROM nodes WHERE kind='Technology'"
    ).fetchall()
    for node_id, key, props_json in rows:
        props = json.loads(props_json) if props_json else {}
        cves = props.get("known_cves", [])
        if not cves:
            continue
        name = props.get("name", key)
        version = props.get("version", "")
        label = f"{name} {version}".strip()

        critical = [c for c in cves if c.get("severity") == "critical"]
        high = [c for c in cves if c.get("severity") == "high"]
        exploitable = [c for c in cves if c.get("exploit_available")]

        if critical or exploitable:
            priority = "critical"
        elif high:
            priority = "high"
        else:
            priority = "medium"

        top_cves = (critical + high + exploitable)[:5]
        cve_list = ", ".join(c["cve_id"] for c in top_cves)

        actions: list[dict[str, str]] = []
        for c in top_cves[:3]:
            actions.append({"label": f"Details: {c['cve_id']}", "type": "cve_detail", "cve_id": c["cve_id"]})
            if c.get("exploit_available"):
                actions.append({"label": f"Exploit available for {c['cve_id']}", "type": "exploit_link", "cve_id": c["cve_id"]})

        results.append(Suggestion(
            id=f"cve_{key}",
            priority=priority,
            category="cve",
            title=f"{label} — {len(cves)} known CVEs",
            detail=f"Top CVEs: {cve_list}. {len(exploitable)} with known exploits.",
            evidence=[f"Technology: {label}", f"CVE count: {len(cves)}"],
            actions=actions,
            related_nodes=[node_id],
        ))
    return results


# ── Rule: Sensitive paths with false-positive detection ──

# Files that should NOT be text/html if real — if server returns HTML, it's a custom 404
_FILE_PATTERNS = {
    ".git": ("critical", "Git repository exposed — source code and secrets may be downloadable",
             [{"label": "Run gitleaks", "type": "run_tool", "tool_id": "gitleaks"}]),
    ".env": ("critical", "Environment file exposed — likely contains credentials and API keys", []),
    ".svn": ("high", "SVN directory exposed — source code may be accessible", []),
    ".DS_Store": ("medium", ".DS_Store file exposed — reveals directory structure", []),
    ".htaccess": ("medium", ".htaccess exposed — server configuration leak", []),
    "robots.txt": ("info", "robots.txt found — may reveal hidden paths", []),
    "wp-config.php": ("critical", "WordPress config file exposed — contains database credentials", []),
    "config.php": ("high", "Config file exposed — may contain credentials", []),
    "xmlrpc.php": ("medium", "WordPress XMLRPC accessible — brute force and SSRF vector", []),
}
# Paths that CAN legitimately be HTML pages
_PAGE_PATTERNS = {
    "wp-admin": ("medium", "WordPress admin panel found",
                 [{"label": "Check default creds", "type": "action"}]),
    "phpmyadmin": ("high", "phpMyAdmin exposed — database management interface", []),
    "admin": ("medium", "Admin panel found — check for default credentials or registration",
              [{"label": "Try registration", "type": "action"}, {"label": "Check default creds", "type": "action"}]),
    "debug": ("medium", "Debug endpoint found — may expose internal application state", []),
    "phpinfo": ("high", "phpinfo() exposed — reveals PHP configuration and system details", []),
    "server-status": ("high", "Apache server-status exposed — reveals active connections", []),
    "swagger": ("medium", "Swagger/OpenAPI documentation exposed", []),
    "graphql": ("medium", "GraphQL endpoint found — test for introspection and injection", []),
}


def _sensitive_path_suggestions(conn: Any) -> list[Suggestion]:
    results: list[Suggestion] = []
    rows = conn.execute(
        "SELECT id, properties_json FROM nodes WHERE kind='Endpoint' "
        "AND json_extract(properties_json, '$.status_code') < 404"
    ).fetchall()

    # Compute baseline: most common content-type + response body indicators
    # If many endpoints have the same content_type=text/html, a "file" returning HTML is likely a soft 404
    baseline_html_count = sum(
        1 for _, pj in rows
        if (json.loads(pj) if pj else {}).get("content_type", "").startswith("text/html")
    )
    most_are_html = baseline_html_count > len(rows) * 0.7

    seen: set[str] = set()
    all_patterns = {**_FILE_PATTERNS, **_PAGE_PATTERNS}

    for node_id, props_json in rows:
        props = json.loads(props_json) if props_json else {}
        url = props.get("url", "")
        url_lower = url.lower()
        ctype = (props.get("content_type") or "").lower()
        status = props.get("status_code", 200)

        for pattern, (priority, detail, actions) in all_patterns.items():
            if f"/{pattern}" not in url_lower and not url_lower.endswith(f"/{pattern}"):
                continue
            dedup_key = f"sensitive_{pattern}"
            if dedup_key in seen:
                continue

            # False positive detection for file-type paths
            if pattern in _FILE_PATTERNS:
                # If a file like .env returns text/html, it's almost certainly a soft 404
                if "text/html" in ctype and most_are_html:
                    continue
                # 302 redirects to home page are also soft 404s
                if status in (301, 302) and pattern not in ("admin",):
                    continue

            # For page-type paths, check if it's a real distinct page vs generic response
            if pattern in _PAGE_PATTERNS:
                # 302 to a login page is a real admin panel behind auth
                if status in (301, 302):
                    detail = f"{detail} (redirects — likely behind authentication)"

            seen.add(dedup_key)
            results.append(Suggestion(
                id=dedup_key,
                priority=priority,
                category="exposure",
                title=f"Sensitive path: /{pattern}",
                detail=detail,
                evidence=[f"URL: {url}", f"Status: {status}", f"Content-Type: {ctype or 'unknown'}"],
                actions=actions,
                related_nodes=[node_id],
            ))
    return results


# ── Rule: Interesting forms ──

def _form_suggestions(conn: Any) -> list[Suggestion]:
    results: list[Suggestion] = []
    rows = conn.execute(
        "SELECT id, properties_json FROM nodes WHERE kind='Form'"
    ).fetchall()
    for node_id, props_json in rows:
        props = json.loads(props_json) if props_json else {}
        action_url = props.get("action_url", "")
        method = props.get("method", "GET").upper()
        fields = props.get("input_fields", "")
        if isinstance(fields, str):
            fields_lower = fields.lower()
        else:
            fields_lower = json.dumps(fields).lower()

        # Login form
        if "password" in fields_lower and ("login" in action_url.lower() or "signin" in action_url.lower() or "auth" in action_url.lower()):
            results.append(Suggestion(
                id=f"form_login_{node_id[:12]}",
                priority="medium",
                category="action",
                title="Login form found",
                detail=f"Login form at {action_url} — test for default credentials, brute force, SQL injection",
                evidence=[f"Form: {method} {action_url}", f"Fields: {fields_lower[:100]}"],
                actions=[{"label": "Test default creds", "type": "action"}, {"label": "Test SQLi", "type": "action"}],
                related_nodes=[node_id],
            ))

        # Registration form
        if "password" in fields_lower and ("register" in action_url.lower() or "signup" in action_url.lower() or "create" in fields_lower):
            results.append(Suggestion(
                id=f"form_register_{node_id[:12]}",
                priority="medium",
                category="action",
                title="Registration form found",
                detail=f"Registration at {action_url} — test for account enumeration, privilege escalation",
                evidence=[f"Form: {method} {action_url}"],
                actions=[{"label": "Try registering", "type": "action"}, {"label": "Test for enum", "type": "action"}],
                related_nodes=[node_id],
            ))

        # File upload
        if "file" in fields_lower:
            results.append(Suggestion(
                id=f"form_upload_{node_id[:12]}",
                priority="high",
                category="action",
                title="File upload form found",
                detail=f"Upload form at {action_url} — test for unrestricted file upload (webshell)",
                evidence=[f"Form: {method} {action_url}"],
                actions=[{"label": "Test upload restrictions", "type": "action"}],
                related_nodes=[node_id],
            ))

    return results


# ── Rule: Missing security headers ──

def _security_header_suggestions(conn: Any) -> list[Suggestion]:
    results: list[Suggestion] = []
    rows = conn.execute(
        "SELECT id, properties_json FROM nodes WHERE kind='Endpoint' "
        "AND json_extract(properties_json, '$.missing_headers') IS NOT NULL"
    ).fetchall()
    if rows:
        results.append(Suggestion(
            id="missing_headers",
            priority="low",
            category="config",
            title=f"Missing security headers on {len(rows)} endpoints",
            detail="Endpoints missing headers like Content-Security-Policy, X-Frame-Options, X-Content-Type-Options",
            evidence=[f"{len(rows)} endpoints affected"],
            actions=[],
            related_nodes=[r[0] for r in rows[:5]],
        ))
    return results


# ── Rule: Technology-specific checks ──

_TECH_CHECKS: dict[str, list[dict[str, Any]]] = {
    "WordPress": [
        {"title": "WordPress detected — check common attack vectors",
         "detail": "Test /wp-login.php, /xmlrpc.php, /wp-json/wp/v2/users (user enumeration), plugin/theme vulnerabilities",
         "priority": "medium", "actions": [
             {"label": "Enumerate users via REST API", "type": "action"},
             {"label": "Run nuclei WordPress templates", "type": "scan", "tool": "nuclei", "tags": "wordpress"},
         ]},
    ],
    "Joomla": [
        {"title": "Joomla detected — check admin and known CVEs",
         "detail": "Test /administrator, check Joomla version for known CVEs",
         "priority": "medium", "actions": [
             {"label": "Run nuclei Joomla templates", "type": "scan", "tool": "nuclei", "tags": "joomla"},
         ]},
    ],
    "Drupal": [
        {"title": "Drupal detected — check for Drupalgeddon and known CVEs",
         "detail": "Test /user/login, check version, Drupalgeddon2/3 if outdated",
         "priority": "medium", "actions": [
             {"label": "Run nuclei Drupal templates", "type": "scan", "tool": "nuclei", "tags": "drupal"},
         ]},
    ],
    "phpMyAdmin": [
        {"title": "phpMyAdmin detected — critical exposure",
         "detail": "Database admin interface exposed. Test for default credentials (root/empty, root/root)",
         "priority": "critical", "actions": [{"label": "Test default credentials", "type": "action"}]},
    ],
    "Apache Tomcat": [
        {"title": "Apache Tomcat detected — check manager interface",
         "detail": "Test /manager/html with default credentials (tomcat/tomcat, admin/admin)",
         "priority": "high", "actions": [
             {"label": "Test default creds", "type": "action"},
             {"label": "Run nuclei Tomcat templates", "type": "scan", "tool": "nuclei", "tags": "tomcat"},
         ]},
    ],
    "Ruby on Rails": [
        {"title": "Ruby on Rails detected — check for common misconfigurations",
         "detail": "Test for debug mode, mass assignment, CSRF bypass, session fixation",
         "priority": "medium", "actions": [
             {"label": "Run nuclei Rails templates", "type": "scan", "tool": "nuclei", "tags": "rails"},
         ]},
    ],
}


def _tech_specific_suggestions(conn: Any) -> list[Suggestion]:
    results: list[Suggestion] = []
    rows = conn.execute(
        "SELECT id, key, properties_json FROM nodes WHERE kind='Technology'"
    ).fetchall()
    for node_id, key, props_json in rows:
        props = json.loads(props_json) if props_json else {}
        name = props.get("name", "")
        checks = _TECH_CHECKS.get(name, [])
        for i, check in enumerate(checks):
            results.append(Suggestion(
                id=f"tech_{name.lower().replace(' ', '_')}_{i}",
                priority=check["priority"],
                category="tech",
                title=check["title"],
                detail=check["detail"],
                evidence=[f"Technology: {name}", f"Version: {props.get('version', 'unknown')}"],
                actions=check.get("actions", []),
                related_nodes=[node_id],
            ))
    return results


# ── Rule: Exposure combinations ──

def _exposure_suggestions(conn: Any) -> list[Suggestion]:
    results: list[Suggestion] = []

    # Server errors (5xx)
    errors = conn.execute(
        "SELECT COUNT(*) FROM nodes WHERE kind='Endpoint' "
        "AND CAST(json_extract(properties_json, '$.status_code') AS INTEGER) >= 500"
    ).fetchone()[0]
    if errors:
        results.append(Suggestion(
            id="server_errors",
            priority="medium",
            category="exposure",
            title=f"{errors} server errors (5xx) found",
            detail="Server errors may reveal stack traces, internal paths, or debug information",
            evidence=[f"{errors} endpoints returned 5xx"],
            actions=[{"label": "Review error responses", "type": "action"}],
        ))

    # CORS wildcard
    cors = conn.execute(
        "SELECT COUNT(*) FROM nodes WHERE kind='Finding' "
        "AND json_extract(properties_json, '$.template_id') LIKE '%cors%'"
    ).fetchone()[0]
    if cors:
        results.append(Suggestion(
            id="cors_wildcard",
            priority="medium",
            category="config",
            title="CORS wildcard detected",
            detail="Access-Control-Allow-Origin: * allows any domain to make authenticated requests",
            evidence=[f"{cors} endpoints affected"],
            actions=[],
        ))

    return results
