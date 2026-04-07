"""Import side-effect: registers all ingestors (order matters for ambiguous extensions)."""

# SARIF / scanner JSON (specific fingerprints before generic httpx JSON)
from gossamer.ingestors import sarif_json  # noqa: F401
from gossamer.ingestors import trivy_json  # noqa: F401
from gossamer.ingestors import grype_json  # noqa: F401
from gossamer.ingestors import dependency_check_json  # noqa: F401
from gossamer.ingestors import snyk_test_json  # noqa: F401
from gossamer.ingestors import npm_audit_json  # noqa: F401
from gossamer.ingestors import pip_audit_json  # noqa: F401
from gossamer.ingestors import checkov_json  # noqa: F401
from gossamer.ingestors import bandit_json  # noqa: F401
from gossamer.ingestors import semgrep_json  # noqa: F401
from gossamer.ingestors import trufflehog_json  # noqa: F401
from gossamer.ingestors import gitleaks_json  # noqa: F401
from gossamer.ingestors import wpscan_json  # noqa: F401
from gossamer.ingestors import burp_xml  # noqa: F401
from gossamer.ingestors import zap_json  # noqa: F401
from gossamer.ingestors import ffuf_json  # noqa: F401
from gossamer.ingestors import katana_jsonl  # noqa: F401
from gossamer.ingestors import nuclei_json  # noqa: F401
from gossamer.ingestors import httpx_json  # noqa: F401
from gossamer.ingestors import crawl  # noqa: F401
