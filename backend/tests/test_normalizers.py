from __future__ import annotations

from gossamer.normalizers.collapse_trailing_slash import CollapseTrailingSlash
from gossamer.normalizers.lowercase_host import LowercaseHost
from gossamer.normalizers.strip_utm import StripUtm


def test_lowercase_host_normalizer() -> None:
    n = LowercaseHost()
    ctx: dict = {}
    assert n.normalize_host("Example.COM", ctx) == "example.com"
    assert n.normalize_url_string("https://EXAMPLE.com/PaTh", ctx) == "https://example.com/PaTh"


def test_collapse_trailing_slash() -> None:
    n = CollapseTrailingSlash()
    ctx: dict = {}
    u = n.normalize_url_string("https://x.test/foo/bar/", ctx)
    assert u == "https://x.test/foo/bar"


def test_strip_utm_removes_tracking_params() -> None:
    n = StripUtm()
    ctx: dict = {}
    u = n.normalize_url_string("https://x.test/a?utm_source=1&gclid=2&ok=1", ctx)
    assert "utm_source" not in u
    assert "gclid" not in u
    assert "ok=1" in u
