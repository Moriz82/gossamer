from __future__ import annotations

from gossamer.graph_types.registry import (
    EDGE_TYPE_DEFS,
    NODE_TYPE_DEFS,
    graph_type_registry_payload,
)
from gossamer.graph_types.nodes.host import HostNode


def test_stable_ids_deterministic() -> None:
    h = HostNode()
    a = h.stable_id("Example.COM")
    b = h.stable_id("example.com")
    assert a == b
    assert a.startswith("host:")


def test_graph_type_registry_payload_shape() -> None:
    p = graph_type_registry_payload()
    assert set(p.keys()) == {"nodes", "edges"}
    for nk, meta in p["nodes"].items():
        assert meta["kind"] == nk
        assert "color" in meta

    assert NODE_TYPE_DEFS.keys() == p["nodes"].keys()
    assert EDGE_TYPE_DEFS.keys() == p["edges"].keys()
