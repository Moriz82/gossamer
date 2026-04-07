from __future__ import annotations

from pathlib import Path
from typing import Any

from gossamer.config import Settings, get_settings
from gossamer.graph_store.sqlite_store import SqliteGraphStore
from gossamer.graph_types.registry import EDGE_TYPE_DEFS, NODE_TYPE_DEFS
from gossamer.ingestors.plugins import *  # noqa: F401,F403 - register ingestors
from gossamer.ingestors.registry import get_ingestor
from gossamer.models import (
    IngestContext,
    NormalizedEdge,
    NormalizedNode,
    RawEdge,
    RawNode,
    RawObservationBatch,
)
from gossamer.normalizers.registry import build_chain


def _normalize_url(url: str, chain: list[Any], ctx: dict[str, Any]) -> str:
    out = url
    for step in chain:
        fn = getattr(step, "normalize_url_string", None)
        if callable(fn):
            out = fn(out, ctx)
    return out


def _normalize_host(host: str, chain: list[Any], ctx: dict[str, Any]) -> str:
    out = host
    for step in chain:
        fn = getattr(step, "normalize_host", None)
        if callable(fn):
            out = fn(out, ctx)
    return out


def _norm_endpoint_key(key: str, chain: list[Any], nctx: dict[str, Any]) -> str:
    if "|" not in key:
        return key
    method, url = key.split("|", 1)
    url2 = _normalize_url(url, chain, nctx)
    return f"{method.upper()}|{url2}"


def _normalize_batch(batch: RawObservationBatch, settings: Settings) -> RawObservationBatch:
    chain = build_chain(settings.normalizer_order)
    nctx: dict[str, Any] = {}
    nodes: list[RawNode] = []

    for n in batch.nodes:
        props = dict(n.properties)
        key = n.key
        if n.kind == "Host":
            key = _normalize_host(n.key, chain, nctx)
            if "hostname" in props:
                props["hostname"] = _normalize_host(str(props["hostname"]), chain, nctx)
        elif n.kind == "Endpoint":
            url = str(props.get("url") or "")
            if url:
                url2 = _normalize_url(url, chain, nctx)
                props["url"] = url2
                key = f"{props.get('method', 'GET').upper()}|{url2}"
            else:
                key = _norm_endpoint_key(n.key, chain, nctx)
        elif n.kind == "Source":
            key = n.key
        nodes.append(RawNode(kind=n.kind, key=key, properties=props, source=n.source))

    edges: list[RawEdge] = []
    for e in batch.edges:
        sk = e.src_key
        dk = e.dst_key
        if e.src_kind == "Host":
            sk = _normalize_host(sk, chain, nctx)
        elif e.src_kind == "Endpoint":
            sk = _norm_endpoint_key(sk, chain, nctx)
        if e.dst_kind == "Host":
            dk = _normalize_host(dk, chain, nctx)
        elif e.dst_kind == "Endpoint":
            dk = _norm_endpoint_key(dk, chain, nctx)
        edges.append(
            RawEdge(
                kind=e.kind,
                src_kind=e.src_kind,
                src_key=sk,
                dst_kind=e.dst_kind,
                dst_key=dk,
                properties=dict(e.properties),
                source=e.source,
            )
        )
    return RawObservationBatch(nodes=nodes, edges=edges)


def persist_batch(store: SqliteGraphStore, batch: RawObservationBatch) -> None:
    node_ids: dict[tuple[str, str], str] = {}
    for n in batch.nodes:
        typ = NODE_TYPE_DEFS.get(n.kind)
        if not typ:
            continue
        nid = typ.stable_id(n.key)
        node_ids[(n.kind, n.key)] = nid
        store.upsert_node(
            NormalizedNode(id=nid, kind=n.kind, key=n.key, properties=n.properties, source=n.source),
            merge_properties={},
        )

    for e in batch.edges:
        st = NODE_TYPE_DEFS.get(e.src_kind)
        dt = NODE_TYPE_DEFS.get(e.dst_kind)
        et = EDGE_TYPE_DEFS.get(e.kind)
        if not st or not dt or not et:
            continue
        src_id = node_ids.get((e.src_kind, e.src_key))
        dst_id = node_ids.get((e.dst_kind, e.dst_key))
        if not src_id or not dst_id:
            continue
        eid = et.stable_id(src_id, dst_id, e.properties)
        store.upsert_edge(
            NormalizedEdge(
                id=eid,
                kind=e.kind,
                src_id=src_id,
                dst_id=dst_id,
                properties=e.properties,
                source=e.source,
            ),
            merge_properties={},
        )


def run_ingest(
    path: Path,
    source_label: str,
    ingestor_hint: str | None = None,
    settings: Settings | None = None,
    extra_options: dict[str, Any] | None = None,
) -> RawObservationBatch:
    settings = settings or get_settings()
    ingestor = get_ingestor(path, hint=ingestor_hint)
    if ingestor is None:
        raise ValueError(f"No ingestor for path {path} (hint={ingestor_hint})")
    ctx = IngestContext(path=path, source_label=source_label, options=extra_options or {})
    if ingestor.name == "crawl_seed":
        ctx.options = {**ctx.options, "settings": settings}
    batch = ingestor.ingest(ctx)
    batch = _normalize_batch(batch, settings)
    return batch


def ingest_and_store(
    store: SqliteGraphStore,
    path: Path,
    source_label: str,
    ingestor_hint: str | None = None,
    settings: Settings | None = None,
    extra_options: dict[str, Any] | None = None,
) -> dict[str, int]:
    batch = run_ingest(path, source_label, ingestor_hint, settings, extra_options)
    persist_batch(store, batch)
    return {"nodes": len(batch.nodes), "edges": len(batch.edges)}
