"""Tests for HTML form extraction."""
from __future__ import annotations

import json

from gossamer.ingestors.forms import extract_forms


def test_simple_login_form():
    html = """
    <form action="/login" method="POST">
        <input type="text" name="username" />
        <input type="password" name="password" />
        <input type="submit" name="submit" value="Login" />
    </form>
    """
    forms = extract_forms(html, "https://example.com/page")
    assert len(forms) == 1
    f = forms[0]
    assert f.action_url == "https://example.com/login"
    assert f.method == "POST"
    assert len(f.input_fields) == 3
    names = [field["name"] for field in f.input_fields]
    assert "username" in names
    assert "password" in names
    assert "submit" in names


def test_form_no_action_defaults_to_current_url():
    html = '<form method="POST"><input name="q" type="text" /></form>'
    forms = extract_forms(html, "https://example.com/search")
    assert len(forms) == 1
    assert forms[0].action_url == "https://example.com/search"


def test_multiple_forms():
    html = """
    <form action="/a" method="POST"><input name="x" /></form>
    <form action="/b" method="GET"><input name="y" /></form>
    """
    forms = extract_forms(html, "https://example.com/")
    assert len(forms) == 2
    urls = {f.action_url for f in forms}
    assert "https://example.com/a" in urls
    assert "https://example.com/b" in urls


def test_hidden_input_fields_captured():
    html = """
    <form action="/submit" method="POST">
        <input type="hidden" name="csrf_token" value="abc123" />
        <input type="text" name="email" />
    </form>
    """
    forms = extract_forms(html, "https://example.com/")
    assert len(forms) == 1
    fields = forms[0].input_fields
    hidden = [f for f in fields if f["type"] == "hidden"]
    assert len(hidden) == 1
    assert hidden[0]["name"] == "csrf_token"
    assert hidden[0]["value"] == "abc123"


def test_file_upload_multipart_enctype():
    html = """
    <form action="/upload" method="POST" enctype="multipart/form-data">
        <input type="file" name="document" />
    </form>
    """
    forms = extract_forms(html, "https://example.com/")
    assert len(forms) == 1
    assert forms[0].enctype == "multipart/form-data"
    assert forms[0].input_fields[0]["type"] == "file"


def test_select_and_textarea_elements():
    html = """
    <form action="/feedback" method="POST">
        <select name="rating"><option value="1">1</option></select>
        <textarea name="comments"></textarea>
    </form>
    """
    forms = extract_forms(html, "https://example.com/")
    assert len(forms) == 1
    fields = forms[0].input_fields
    assert len(fields) == 2
    types = {f["type"] for f in fields}
    assert "select" in types
    assert "textarea" in types


def test_form_method_defaults_to_get():
    html = '<form action="/search"><input name="q" /></form>'
    forms = extract_forms(html, "https://example.com/")
    assert len(forms) == 1
    assert forms[0].method == "GET"


def test_form_with_post_method():
    html = '<form action="/api" method="post"><input name="data" /></form>'
    forms = extract_forms(html, "https://example.com/")
    assert len(forms) == 1
    assert forms[0].method == "POST"


def test_form_id_captured():
    html = '<form id="login-form" action="/login"><input name="u" /></form>'
    forms = extract_forms(html, "https://example.com/")
    assert len(forms) == 1
    assert forms[0].form_id == "login-form"


def test_form_id_none_when_absent():
    html = '<form action="/login"><input name="u" /></form>'
    forms = extract_forms(html, "https://example.com/")
    assert len(forms) == 1
    assert forms[0].form_id is None


def test_relative_action_resolved():
    html = '<form action="submit"><input name="x" /></form>'
    forms = extract_forms(html, "https://example.com/app/page")
    assert len(forms) == 1
    assert forms[0].action_url == "https://example.com/app/submit"


def test_input_without_name_skipped():
    html = """
    <form action="/go">
        <input type="submit" />
        <input type="text" name="keep" />
    </form>
    """
    forms = extract_forms(html, "https://example.com/")
    assert len(forms) == 1
    assert len(forms[0].input_fields) == 1
    assert forms[0].input_fields[0]["name"] == "keep"
