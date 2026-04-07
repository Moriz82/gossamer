"""HTML form extraction for attack surface discovery."""
from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urljoin


@dataclass
class FormInfo:
    action_url: str
    method: str  # GET or POST
    input_fields: list[dict[str, str]]  # [{"name": "user", "type": "text"}, ...]
    form_id: str | None = None
    enctype: str = "application/x-www-form-urlencoded"


_FORM_TAG = re.compile(r"<form\b([^>]*)>(.*?)</form>", re.I | re.S)
_ATTR = re.compile(r'(\w+)=["\']([^"\']*)["\']', re.I)
_INPUT = re.compile(r"<input\b([^>]*)/?>" , re.I)
_SELECT = re.compile(r"<select\b([^>]*)>", re.I)
_TEXTAREA = re.compile(r"<textarea\b([^>]*)>", re.I)


def _parse_attrs(tag_attrs: str) -> dict[str, str]:
    return {m.group(1).lower(): m.group(2) for m in _ATTR.finditer(tag_attrs)}


def extract_forms(html: str, base_url: str) -> list[FormInfo]:
    """Extract form metadata from HTML."""
    forms: list[FormInfo] = []
    for m in _FORM_TAG.finditer(html):
        form_attrs = _parse_attrs(m.group(1))
        form_body = m.group(2)

        action = form_attrs.get("action", "")
        action_url = urljoin(base_url, action) if action else base_url
        method = form_attrs.get("method", "GET").upper()
        form_id = form_attrs.get("id")
        enctype = form_attrs.get("enctype", "application/x-www-form-urlencoded")

        fields: list[dict[str, str]] = []
        for inp in _INPUT.finditer(form_body):
            attrs = _parse_attrs(inp.group(1))
            name = attrs.get("name", "")
            if name:
                entry: dict[str, str] = {
                    "name": name,
                    "type": attrs.get("type", "text"),
                }
                if "value" in attrs:
                    entry["value"] = attrs["value"]
                fields.append(entry)
        for sel in _SELECT.finditer(form_body):
            attrs = _parse_attrs(sel.group(1))
            if attrs.get("name"):
                fields.append({"name": attrs["name"], "type": "select"})
        for ta in _TEXTAREA.finditer(form_body):
            attrs = _parse_attrs(ta.group(1))
            if attrs.get("name"):
                fields.append({"name": attrs["name"], "type": "textarea"})

        forms.append(
            FormInfo(
                action_url=action_url,
                method=method,
                input_fields=fields,
                form_id=form_id,
                enctype=enctype,
            )
        )
    return forms
