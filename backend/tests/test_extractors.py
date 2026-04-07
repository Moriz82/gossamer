from __future__ import annotations

from gossamer.ingestors.extractors import (
    extract_all,
    extract_links_html,
    extract_links_javascript,
    extract_links_json,
)

BASE = "https://example.com/page"


# ---------------------------------------------------------------------------
# HTML extractor
# ---------------------------------------------------------------------------


def test_html_a_href() -> None:
    html = '<a href="/about">About</a>'
    links = extract_links_html(html, BASE)
    assert any(l.url == "https://example.com/about" and l.context == "a.href" for l in links)


def test_html_script_src() -> None:
    html = '<script src="/js/app.js"></script>'
    links = extract_links_html(html, BASE)
    assert any(l.url == "https://example.com/js/app.js" and l.context == "script.src" for l in links)


def test_html_link_href() -> None:
    html = '<link rel="stylesheet" href="/css/style.css">'
    links = extract_links_html(html, BASE)
    assert any(l.url == "https://example.com/css/style.css" and l.context == "link.href" for l in links)


def test_html_img_src() -> None:
    html = '<img src="/img/logo.png" alt="logo">'
    links = extract_links_html(html, BASE)
    assert any(l.url == "https://example.com/img/logo.png" and l.context == "img.src" for l in links)


def test_html_iframe_src() -> None:
    html = '<iframe src="https://other.com/embed"></iframe>'
    links = extract_links_html(html, BASE)
    assert any(l.url == "https://other.com/embed" and l.context == "iframe.src" for l in links)


def test_html_area_href() -> None:
    html = '<area href="/map/region1" shape="rect">'
    links = extract_links_html(html, BASE)
    assert any(l.url == "https://example.com/map/region1" and l.context == "area.href" for l in links)


def test_html_embed_src() -> None:
    html = '<embed src="/media/video.swf">'
    links = extract_links_html(html, BASE)
    assert any(l.url == "https://example.com/media/video.swf" and l.context == "embed.src" for l in links)


def test_html_source_src() -> None:
    html = '<source src="/media/audio.mp3" type="audio/mpeg">'
    links = extract_links_html(html, BASE)
    assert any(l.url == "https://example.com/media/audio.mp3" and l.context == "embed.src" for l in links)


def test_html_data_url() -> None:
    html = '<div data-url="/api/data"></div>'
    links = extract_links_html(html, BASE)
    assert any(l.url == "https://example.com/api/data" and l.context == "data-url" for l in links)


def test_html_data_href() -> None:
    html = '<div data-href="/api/other"></div>'
    links = extract_links_html(html, BASE)
    assert any(l.url == "https://example.com/api/other" and l.context == "data-url" for l in links)


def test_html_form_action_get() -> None:
    html = '<form action="/search"><input name="q"></form>'
    links = extract_links_html(html, BASE)
    assert any(
        l.url == "https://example.com/search"
        and l.context == "form.action"
        and l.method == "GET"
        for l in links
    )


def test_html_form_action_post() -> None:
    html = '<form method="POST" action="/login"><input name="user"></form>'
    links = extract_links_html(html, BASE)
    assert any(
        l.url == "https://example.com/login"
        and l.context == "form.action"
        and l.method == "POST"
        for l in links
    )


def test_html_meta_refresh() -> None:
    html = '<meta http-equiv="refresh" content="5;url=/new-page">'
    links = extract_links_html(html, BASE)
    assert any(
        l.url == "https://example.com/new-page" and l.context == "meta.refresh"
        for l in links
    )


def test_html_srcset() -> None:
    html = '<img srcset="/img/small.jpg 480w, /img/large.jpg 1024w">'
    links = extract_links_html(html, BASE)
    urls = [l.url for l in links if l.via == "srcset"]
    assert "https://example.com/img/small.jpg" in urls
    assert "https://example.com/img/large.jpg" in urls


def test_html_relative_url_resolution() -> None:
    html = '<a href="sub/page">link</a>'
    links = extract_links_html(html, "https://example.com/dir/")
    assert any(l.url == "https://example.com/dir/sub/page" for l in links)


def test_html_absolute_url_preserved() -> None:
    html = '<a href="https://other.com/path">link</a>'
    links = extract_links_html(html, BASE)
    assert any(l.url == "https://other.com/path" for l in links)


def test_html_combined() -> None:
    """Multiple different element types in one document."""
    html = """
    <html><head>
        <link href="/css/main.css" rel="stylesheet">
        <script src="/js/main.js"></script>
        <meta http-equiv="refresh" content="0;url=/redirect">
    </head><body>
        <a href="/about">About</a>
        <img src="/logo.png">
        <iframe src="/widget"></iframe>
        <form method="post" action="/submit"><input></form>
        <img srcset="/sm.jpg 1x, /lg.jpg 2x">
        <area href="/map">
        <div data-url="/api/info"></div>
    </body></html>
    """
    links = extract_links_html(html, BASE)
    contexts = {l.context for l in links}
    assert "a.href" in contexts
    assert "script.src" in contexts
    assert "link.href" in contexts
    assert "img.src" in contexts
    assert "iframe.src" in contexts
    assert "form.action" in contexts
    assert "meta.refresh" in contexts
    assert "img.srcset" in contexts
    assert "area.href" in contexts
    assert "data-url" in contexts


# ---------------------------------------------------------------------------
# JavaScript extractor
# ---------------------------------------------------------------------------


def test_js_fetch() -> None:
    js = "fetch('/api/users').then(r => r.json())"
    links = extract_links_javascript(js, BASE)
    assert any(l.url == "https://example.com/api/users" and l.context == "fetch" for l in links)


def test_js_axios_get() -> None:
    js = "axios.get('/api/items')"
    links = extract_links_javascript(js, BASE)
    assert any(l.url == "https://example.com/api/items" and l.context == "fetch" for l in links)


def test_js_axios_post() -> None:
    js = "axios.post('/api/create', data)"
    links = extract_links_javascript(js, BASE)
    assert any(l.url == "https://example.com/api/create" and l.context == "fetch" for l in links)


def test_js_xhr_open() -> None:
    js = 'xhr.open("GET", "/api/data", true)'
    links = extract_links_javascript(js, BASE)
    assert any(l.url == "https://example.com/api/data" and l.context == "xhr.open" for l in links)


def test_js_location() -> None:
    js = 'window.location.href = "/dashboard"'
    links = extract_links_javascript(js, BASE)
    assert any(l.url == "https://example.com/dashboard" and l.context == "location" for l in links)


def test_js_location_no_window() -> None:
    js = 'location = "/home"'
    links = extract_links_javascript(js, BASE)
    assert any(l.url == "https://example.com/home" and l.context == "location" for l in links)


def test_js_url_literal() -> None:
    js = 'var endpoint = "https://api.example.com/v2/resource"'
    links = extract_links_javascript(js, BASE)
    assert any(
        l.url == "https://api.example.com/v2/resource" and l.context == "url_literal"
        for l in links
    )


def test_js_api_path() -> None:
    js = 'const path = "/api/v1/users/list"'
    links = extract_links_javascript(js, BASE)
    assert any(l.url == "https://example.com/api/v1/users/list" for l in links)


def test_js_v_path() -> None:
    js = 'const url = "/v2/health"'
    links = extract_links_javascript(js, BASE)
    assert any(l.url == "https://example.com/v2/health" for l in links)


def test_js_deduplication() -> None:
    """Same URL mentioned multiple times should only appear once."""
    js = """
    fetch('/api/users');
    fetch('/api/users');
    """
    links = extract_links_javascript(js, BASE)
    urls = [l.url for l in links]
    assert urls.count("https://example.com/api/users") == 1


# ---------------------------------------------------------------------------
# JSON extractor
# ---------------------------------------------------------------------------


def test_json_absolute_url() -> None:
    body = '{"link": "https://example.com/resource"}'
    links = extract_links_json(body, BASE)
    assert any(l.url == "https://example.com/resource" for l in links)


def test_json_relative_path() -> None:
    body = '{"path": "/api/items"}'
    links = extract_links_json(body, BASE)
    assert any(l.url == "https://example.com/api/items" for l in links)


def test_json_nested() -> None:
    body = '{"data": {"inner": {"url": "https://example.com/deep"}}}'
    links = extract_links_json(body, BASE)
    assert any(l.url == "https://example.com/deep" for l in links)


def test_json_array() -> None:
    body = '{"urls": ["/a", "/b", "/c"]}'
    links = extract_links_json(body, BASE)
    urls = {l.url for l in links}
    assert "https://example.com/a" in urls
    assert "https://example.com/b" in urls
    assert "https://example.com/c" in urls


def test_json_deduplication() -> None:
    body = '{"a": "/same", "b": "/same"}'
    links = extract_links_json(body, BASE)
    urls = [l.url for l in links]
    assert urls.count("https://example.com/same") == 1


def test_json_ignores_non_url_strings() -> None:
    body = '{"name": "hello", "count": 42, "flag": true}'
    links = extract_links_json(body, BASE)
    assert len(links) == 0


def test_json_malformed_returns_empty() -> None:
    links = extract_links_json("{not valid json", BASE)
    assert links == []


def test_json_empty_string_returns_empty() -> None:
    links = extract_links_json("", BASE)
    assert links == []


# ---------------------------------------------------------------------------
# extract_all dispatch
# ---------------------------------------------------------------------------


def test_extract_all_html() -> None:
    html = '<a href="/link">go</a>'
    links = extract_all(html, "text/html; charset=utf-8", BASE)
    assert any(l.context == "a.href" for l in links)


def test_extract_all_xhtml() -> None:
    html = '<a href="/link">go</a>'
    links = extract_all(html, "application/xhtml+xml", BASE)
    assert any(l.context == "a.href" for l in links)


def test_extract_all_javascript() -> None:
    js = "fetch('/api/x')"
    links = extract_all(js, "application/javascript", BASE)
    assert any(l.context == "fetch" for l in links)


def test_extract_all_json() -> None:
    body = '{"url": "/api/y"}'
    links = extract_all(body, "application/json", BASE)
    assert any(l.context == "json_value" for l in links)


def test_extract_all_unknown_content_type() -> None:
    links = extract_all("binary data", "application/octet-stream", BASE)
    assert links == []


def test_extract_all_empty_body() -> None:
    links = extract_all("", "text/html", BASE)
    assert links == []


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------


def test_html_empty_string() -> None:
    assert extract_links_html("", BASE) == []


def test_js_empty_string() -> None:
    assert extract_links_javascript("", BASE) == []


def test_html_no_links() -> None:
    html = "<html><body><p>No links here</p></body></html>"
    assert extract_links_html(html, BASE) == []


def test_js_no_urls() -> None:
    js = "var x = 1 + 2; console.log(x);"
    assert extract_links_javascript(js, BASE) == []


def test_all_extracted_links_have_via() -> None:
    """Every ExtractedLink from every extractor should have a non-empty via field."""
    html = '<a href="/x"><script src="/y"></script>'
    for link in extract_links_html(html, BASE):
        assert link.via
    js = "fetch('/z')"
    for link in extract_links_javascript(js, BASE):
        assert link.via
    body = '{"u": "/w"}'
    for link in extract_links_json(body, BASE):
        assert link.via
