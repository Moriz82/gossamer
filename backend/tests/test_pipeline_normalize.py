from __future__ import annotations

from gossamer.config import Settings
from gossamer.models import RawEdge, RawNode, RawObservationBatch
from gossamer.pipeline import _normalize_batch


def test_normalize_batch_strips_utm_on_endpoint_url() -> None:
    settings = Settings(
        normalizer_order=["strip_utm", "lowercase_host", "collapse_trailing_slash"]
    )
    batch = RawObservationBatch(
        nodes=[
            RawNode(
                kind="Endpoint",
                key="GET|https://HOST.TEST/Path/?utm_campaign=x",
                properties={"url": "https://HOST.TEST/Path/?utm_campaign=x", "method": "GET"},
                source="s",
            ),
        ],
        edges=[],
    )
    out = _normalize_batch(batch, settings)
    ep = out.nodes[0]
    assert "utm_campaign" not in ep.properties["url"]
    assert ep.properties["url"].startswith("https://host.test/")


def test_normalize_batch_normalizes_host_keys() -> None:
    settings = Settings(normalizer_order=["lowercase_host"])
    batch = RawObservationBatch(
        nodes=[
            RawNode(kind="Host", key="UPPER.test", properties={"hostname": "UPPER.test"}, source="s"),
        ],
        edges=[],
    )
    out = _normalize_batch(batch, settings)
    assert out.nodes[0].key == "upper.test"
    assert out.nodes[0].properties["hostname"] == "upper.test"


def test_normalize_edge_endpoint_keys() -> None:
    settings = Settings(normalizer_order=["lowercase_host", "collapse_trailing_slash", "strip_utm"])
    batch = RawObservationBatch(
        nodes=[
            RawNode(kind="Host", key="h.test", properties={"hostname": "h.test"}, source="s"),
            RawNode(
                kind="Endpoint",
                key="GET|https://h.test/A/",
                properties={"url": "https://h.test/A/", "method": "GET"},
                source="s",
            ),
            RawNode(kind="Source", key="src:1", properties={}, source="s"),
        ],
        edges=[
            RawEdge(
                kind="serves",
                src_kind="Host",
                src_key="h.test",
                dst_kind="Endpoint",
                dst_key="GET|https://h.test/A/",
                properties={"scheme": "https"},
                source="s",
            ),
        ],
    )
    out = _normalize_batch(batch, settings)
    e = out.edges[0]
    assert e.dst_key == "GET|https://h.test/A"
