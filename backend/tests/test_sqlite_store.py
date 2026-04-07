from __future__ import annotations

import json

from gossamer.graph_store.sqlite_store import SqliteGraphStore
from gossamer.graph_types.registry import EDGE_TYPE_DEFS, NODE_TYPE_DEFS
from gossamer.models import NormalizedEdge, NormalizedNode
from gossamer.pipeline import persist_batch
from gossamer.models import RawEdge, RawNode, RawObservationBatch


def test_upsert_node_insert_and_merge(tmp_path) -> None:
    db = tmp_path / "s.sqlite"
    store = SqliteGraphStore(db)
    host_typ = NODE_TYPE_DEFS["Host"]
    hid = host_typ.stable_id("example.com")
    store.upsert_node(
        NormalizedNode(id=hid, kind="Host", key="example.com", properties={"hostname": "example.com"}, source="a"),
        merge_properties={},
    )
    store.upsert_node(
        NormalizedNode(
            id=hid,
            kind="Host",
            key="example.com",
            properties={"hostname": "example.com", "ip": "1.1.1.1"},
            source="b",
        ),
        merge_properties={},
    )
    cur = store._conn.execute("SELECT properties_json FROM nodes WHERE id = ?", (hid,))
    props = json.loads(cur.fetchone()["properties_json"])
    assert props.get("ip") == "1.1.1.1"


def test_upsert_edge_merge_sources(tmp_path) -> None:
    db = tmp_path / "e.sqlite"
    store = SqliteGraphStore(db)
    h = NODE_TYPE_DEFS["Host"]
    ep = NODE_TYPE_DEFS["Endpoint"]
    se = EDGE_TYPE_DEFS["serves"]
    hid = h.stable_id("t.test")
    eid = ep.stable_id("GET|https://t.test/")
    store.upsert_node(
        NormalizedNode(id=hid, kind="Host", key="t.test", properties={"hostname": "t.test"}, source="s"),
        merge_properties={},
    )
    store.upsert_node(
        NormalizedNode(
            id=eid,
            kind="Endpoint",
            key="GET|https://t.test/",
            properties={"url": "https://t.test/", "method": "GET"},
            source="s",
        ),
        merge_properties={},
    )
    edge = NormalizedEdge(
        id=se.stable_id(hid, eid, {"scheme": "https"}),
        kind="serves",
        src_id=hid,
        dst_id=eid,
        properties={"scheme": "https"},
        source="run1",
    )
    store.upsert_edge(edge, merge_properties={})
    store.upsert_edge(
        NormalizedEdge(
            id=edge.id,
            kind="serves",
            src_id=hid,
            dst_id=eid,
            properties={"scheme": "https"},
            source="run2",
        ),
        merge_properties={},
    )
    cur = store._conn.execute("SELECT sources_json FROM edges WHERE id = ?", (edge.id,))
    sources = json.loads(cur.fetchone()["sources_json"])
    assert "run1" in sources and "run2" in sources


def test_snapshot_and_clear(tmp_path) -> None:
    store = SqliteGraphStore(tmp_path / "c.sqlite")
    batch = RawObservationBatch(
        nodes=[
            RawNode(kind="Host", key="h.test", properties={"hostname": "h.test"}, source="t"),
            RawNode(
                kind="Endpoint",
                key="GET|https://h.test/",
                properties={"url": "https://h.test/", "method": "GET"},
                source="t",
            ),
            RawNode(kind="Source", key="ingestor:x:t", properties={}, source="t"),
        ],
        edges=[
            RawEdge(
                kind="serves",
                src_kind="Host",
                src_key="h.test",
                dst_kind="Endpoint",
                dst_key="GET|https://h.test/",
                properties={"scheme": "https"},
                source="t",
            ),
        ],
    )
    persist_batch(store, batch)
    snap = store.get_graph_snapshot()
    assert len(snap["nodes"]) >= 2
    store.clear()
    assert store.get_graph_snapshot()["nodes"] == []
    store.close()


def test_foreign_key_edges_require_nodes(tmp_path) -> None:
    store = SqliteGraphStore(tmp_path / "fk.sqlite")
    store._conn.execute("PRAGMA foreign_keys = ON")
    try:
        store._conn.execute(
            "INSERT INTO edges (id, src_id, dst_id, kind, properties_json, sources_json) VALUES (?,?,?,?,?,?)",
            ("e1", "missing1", "missing2", "serves", "{}", "[]"),
        )
        store._conn.commit()
    except Exception:
        store._conn.rollback()
    else:
        raise AssertionError("expected FK failure")
