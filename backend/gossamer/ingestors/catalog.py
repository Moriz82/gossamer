"""Static descriptions for registered ingestors (UI + API)."""

from __future__ import annotations

INGESTOR_INFO: dict[str, dict[str, str]] = {
    # ── Recon / crawl ─────────────────────────────────────────────
    "httpx_json": {
        "summary": "httpx JSON / JSONL (ndjson) exports.",
        "hints": ".jsonl, .ndjson; some .json with url + status_code/input heuristics.",
        "role": "recon",
    },
    "ffuf_json": {
        "summary": "ffuf JSON output.",
        "hints": ".json with results[] (often includes ffuf/input in content).",
        "role": "recon",
    },
    "katana_jsonl": {
        "summary": "Katana JSON lines.",
        "hints": ".jsonl / .json with request.endpoint style objects.",
        "role": "recon",
    },
    "crawl_seed": {
        "summary": "Live HTTP crawl from a .urlseed file (one URL per line).",
        "hints": ".urlseed — uses crawl_* settings and optional scope_hosts per request.",
        "role": "crawl",
    },
    # ── Web / DAST scanners ─────────────────────────────────────────
    "burp_xml": {
        "summary": "Burp Suite site map / proxy export as XML.",
        "hints": ".xml containing <item> / burp markers.",
        "role": "scanner",
    },
    "zap_json": {
        "summary": "OWASP ZAP report JSON — endpoints + Finding per alert instance.",
        "hints": ".json with site[] alerts or urls[] list.",
        "role": "scanner",
    },
    "nuclei_json": {
        "summary": "Nuclei JSON / JSONL findings (template-id per line).",
        "hints": ".jsonl from nuclei -jsonl / JSON array export; creates Finding nodes.",
        "role": "scanner",
    },
    "wpscan_json": {
        "summary": "WPScan JSON report — plugins, core, and interesting findings.",
        "hints": ".json with target_url and plugins / version / interesting_findings.",
        "role": "scanner",
    },
    # ── Generic SARIF (CodeQL, Semgrep --sarif, ESLint, MSFT, etc.) ─
    "sarif_json": {
        "summary": "SARIF 2.1 — static analysis interchange (many tools).",
        "hints": ".json / .sarif with runs[] and results[].",
        "role": "scanner",
    },
    "semgrep_json": {
        "summary": "Semgrep CLI JSON (--json, not SARIF).",
        "hints": ".json with results[] (no top-level runs[]).",
        "role": "scanner",
    },
    # ── Container / dependency CVE scanners ────────────────────────
    "trivy_json": {
        "summary": "Aqua Trivy JSON (image/fs/repo scans).",
        "hints": ".json with SchemaVersion, ArtifactName, Results[].",
        "role": "scanner",
    },
    "grype_json": {
        "summary": "Anchore Grype JSON vulnerability matches.",
        "hints": ".json with matches[] and vulnerability objects.",
        "role": "scanner",
    },
    "dependency_check_json": {
        "summary": "OWASP Dependency-Check JSON report.",
        "hints": ".json with dependencies[].vulnerabilities[].",
        "role": "scanner",
    },
    "snyk_test_json": {
        "summary": "Snyk CLI test JSON (container/open-source).",
        "hints": "Top-level vulnerabilities[] plus package metadata.",
        "role": "scanner",
    },
    "npm_audit_json": {
        "summary": "npm audit --json (lockfile advisory report).",
        "hints": ".json with vulnerabilities{} map and via[] advisory objects.",
        "role": "scanner",
    },
    "pip_audit_json": {
        "summary": "pip-audit --format json (list of vulnerable deps).",
        "hints": ".json array of {name, version, vuln_id, fix_versions}.",
        "role": "scanner",
    },
    # ── IaC / cloud policy ─────────────────────────────────────────
    "checkov_json": {
        "summary": "Bridgecrew Checkov JSON — failed_checks.",
        "hints": ".json with check_type and results.failed_checks[].",
        "role": "scanner",
    },
    # ── AppSec secrets / SAST ─────────────────────────────────────
    "bandit_json": {
        "summary": "Bandit Python SAST JSON.",
        "hints": ".json with results[] and metrics or bandit_version.",
        "role": "scanner",
    },
    "trufflehog_json": {
        "summary": "Trufflehog JSON / JSONL detector output.",
        "hints": ".json / .jsonl with DetectorName per record.",
        "role": "scanner",
    },
    "gitleaks_json": {
        "summary": "Gitleaks JSON report (array or {findings: []}).",
        "hints": ".json with RuleID, File, Secret / StartLine per finding.",
        "role": "scanner",
    },
}
