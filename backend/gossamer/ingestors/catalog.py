"""Static descriptions for registered ingestors (UI + API)."""

from __future__ import annotations

INGESTOR_INFO: dict[str, dict[str, str]] = {
    "httpx_json": {
        "summary": "httpx JSON / JSONL (ndjson) exports.",
        "hints": ".jsonl, .ndjson; some .json with url + status_code/input heuristics.",
    },
    "burp_xml": {
        "summary": "Burp Suite site map / proxy export as XML.",
        "hints": ".xml containing <item> / burp markers.",
    },
    "zap_json": {
        "summary": "OWASP ZAP report JSON.",
        "hints": ".json with site[] alerts or urls[] list.",
    },
    "ffuf_json": {
        "summary": "ffuf JSON output.",
        "hints": ".json with results[] array (often includes ffuf/input in content).",
    },
    "katana_jsonl": {
        "summary": "Katana JSON lines.",
        "hints": ".jsonl / .json with request.endpoint style objects.",
    },
    "crawl_seed": {
        "summary": "Live HTTP crawl from a .urlseed file (one URL per line).",
        "hints": ".urlseed — uses crawl_* settings and optional scope_hosts per request.",
    },
}
