"""Tests for response header analysis."""
from gossamer.ingestors.headers import extract_header_intel


def test_security_headers_present():
    headers = {
        "Content-Security-Policy": "default-src 'self'",
        "Strict-Transport-Security": "max-age=31536000",
        "X-Frame-Options": "DENY",
        "X-Content-Type-Options": "nosniff",
    }
    intel = extract_header_intel(headers)
    assert "hdr_content_security_policy" in intel.endpoint_props
    assert "hdr_strict_transport_security" in intel.endpoint_props
    assert len(intel.security_flags) == 0


def test_missing_security_headers():
    intel = extract_header_intel({})
    assert "missing_hsts" in intel.security_flags
    assert "missing_csp" in intel.security_flags
    assert "missing_x_frame_options" in intel.security_flags


def test_tech_headers():
    headers = {"Server": "nginx/1.25.3", "X-Powered-By": "Express"}
    intel = extract_header_intel(headers)
    assert intel.host_tech_hints["server"] == "nginx/1.25.3"
    assert intel.host_tech_hints["x_powered_by"] == "Express"


def test_cookies_presence():
    headers = {"Set-Cookie": "session=abc123; Path=/"}
    intel = extract_header_intel(headers)
    assert intel.endpoint_props["sets_cookies"] is True


def test_cors_header():
    headers = {"Access-Control-Allow-Origin": "*"}
    intel = extract_header_intel(headers)
    assert intel.endpoint_props["hdr_cors_origin"] == "*"


def test_empty_headers():
    intel = extract_header_intel({})
    assert len(intel.host_tech_hints) == 0
    assert intel.endpoint_props.get("sets_cookies") is None
