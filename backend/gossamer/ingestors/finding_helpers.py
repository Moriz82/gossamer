"""Shared building blocks for scanner ingestors (Finding → Endpoint, provenance)."""
from __future__ import annotations

import hashlib
from typing import Any
from urllib.parse import urlparse

from gossamer.models import RawEdge, RawNode, RawObservationBatch


def stable_dedup(*parts: str) -> str:
    """Stable short id from logical parts (avoid raw `|` from upstream fields)."""
    s = "\x1e".join((p or "").replace("\x1e", " ") for p in parts)
    return hashlib.sha256(s.encode()).hexdigest()[:22]


def finding_merge_key(scanner: str, dedup_segment: str, target_ref: str) -> str:
    """Node merge key; pipeline normalizes target_ref when it is http(s)."""
    return f"{scanner}|{dedup_segment}|{target_ref}"


def ensure_source(batch: RawObservationBatch, *, ingestor_name: str, source_label: str) -> str:
    key = f"ingestor:{ingestor_name}:{source_label}"
    batch.nodes.append(
        RawNode(
            kind="Source",
            key=key,
            properties={"name": source_label, "ingestor": ingestor_name},
            source=source_label,
        )
    )
    return key


def _artifact_endpoint(url: str, method: str, ep_extra: dict[str, Any] | None) -> tuple[str, str, dict[str, Any]]:
    host_key = "__artifact__"
    method_u = (method or "GET").upper()
    ep_key = f"{method_u}|{url}"
    props: dict[str, Any] = {"url": url, "method": method_u}
    if ep_extra:
        props.update(ep_extra)
    return host_key, ep_key, props


def emit_web_endpoint(
    batch: RawObservationBatch,
    *,
    url: str,
    method: str,
    source_label: str,
    source_key: str,
    endpoint_props: dict[str, Any] | None = None,
) -> tuple[str, str] | None:
    """Create Host, Endpoint, serves, discovered_by for an http(s) URL. Returns (host_key, ep_key)."""
    p = urlparse(url)
    host = (p.hostname or "").lower()
    if not host:
        return None
    host_key = host
    method_u = (method or "GET").upper()
    ep_key = f"{method_u}|{url}"
    props: dict[str, Any] = {"url": url, "method": method_u}
    if endpoint_props:
        props.update(endpoint_props)
    batch.nodes.append(
        RawNode(kind="Host", key=host_key, properties={"hostname": host}, source=source_label)
    )
    batch.nodes.append(
        RawNode(kind="Endpoint", key=ep_key, properties=props, source=source_label)
    )
    batch.edges.append(
        RawEdge(
            kind="serves",
            src_kind="Host",
            src_key=host_key,
            dst_kind="Endpoint",
            dst_key=ep_key,
            properties={"scheme": p.scheme},
            source=source_label,
        )
    )
    batch.edges.append(
        RawEdge(
            kind="discovered_by",
            src_kind="Endpoint",
            src_key=ep_key,
            dst_kind="Source",
            dst_key=source_key,
            properties={},
            source=source_label,
        )
    )
    return host_key, ep_key


def emit_artifact_endpoint(
    batch: RawObservationBatch,
    *,
    artifact_url: str,
    method: str,
    source_label: str,
    source_key: str,
    endpoint_props: dict[str, Any] | None = None,
) -> tuple[str, str]:
    """Non-web ref (file:, pkg:, etc.) pinned under synthetic host for graph consistency."""
    host_key, ep_key, props = _artifact_endpoint(artifact_url, method, endpoint_props)
    batch.nodes.append(
        RawNode(
            kind="Host",
            key=host_key,
            properties={"hostname": "__artifact__"},
            source=source_label,
        )
    )
    batch.nodes.append(
        RawNode(kind="Endpoint", key=ep_key, properties=props, source=source_label)
    )
    batch.edges.append(
        RawEdge(
            kind="serves",
            src_kind="Host",
            src_key=host_key,
            dst_kind="Endpoint",
            dst_key=ep_key,
            properties={"scheme": "none"},
            source=source_label,
        )
    )
    batch.edges.append(
        RawEdge(
            kind="discovered_by",
            src_kind="Endpoint",
            src_key=ep_key,
            dst_kind="Source",
            dst_key=source_key,
            properties={},
            source=source_label,
        )
    )
    return host_key, ep_key


def resolve_target_ref(uri: str) -> tuple[str, str, bool]:
    """
    Return (ref_for_endpoint_url_field, method, is_web).
    Non-URLs become file:// or pkg: style refs (method GET).
    """
    u = (uri or "").strip()
    if not u:
        return "", "GET", False
    if u.startswith("http://") or u.startswith("https://"):
        return u, "GET", True
    if u.startswith("file:") or u.startswith("pkg:"):
        return u, "GET", False
    return f"file://{u.lstrip('/')}", "GET", False


def emit_finding_on_target(
    batch: RawObservationBatch,
    *,
    scanner: str,
    dedup_parts: tuple[str, ...],
    target_uri: str,
    method: str | None,
    source_label: str,
    source_key: str,
    finding_props: dict[str, Any],
    edge_props: dict[str, Any] | None = None,
    endpoint_props: dict[str, Any] | None = None,
) -> None:
    """Attach Endpoint (if needed) + Finding + found_on."""
    ref, default_method, is_web = resolve_target_ref(target_uri)
    if not ref:
        return
    m = (method or default_method or "GET").upper()
    if is_web:
        ep = emit_web_endpoint(
            batch,
            url=ref,
            method=m,
            source_label=source_label,
            source_key=source_key,
            endpoint_props=endpoint_props,
        )
    else:
        ep = emit_artifact_endpoint(
            batch,
            artifact_url=ref,
            method=m,
            source_label=source_label,
            source_key=source_key,
            endpoint_props=endpoint_props,
        )
    if not ep:
        return
    _hk, ep_key = ep
    dedup = stable_dedup(*dedup_parts)
    fk = finding_merge_key(scanner, dedup, ref)
    batch.nodes.append(
        RawNode(kind="Finding", key=fk, properties=finding_props, source=source_label)
    )
    batch.edges.append(
        RawEdge(
            kind="found_on",
            src_kind="Finding",
            src_key=fk,
            dst_kind="Endpoint",
            dst_key=ep_key,
            properties=edge_props or {},
            source=source_label,
        )
    )
