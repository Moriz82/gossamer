"""Import side-effect: registers all ingestors (order matters for ambiguous extensions)."""

from gossamer.ingestors import burp_xml  # noqa: F401
from gossamer.ingestors import zap_json  # noqa: F401
from gossamer.ingestors import ffuf_json  # noqa: F401
from gossamer.ingestors import katana_jsonl  # noqa: F401
from gossamer.ingestors import httpx_json  # noqa: F401
from gossamer.ingestors import crawl  # noqa: F401
