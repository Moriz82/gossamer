from __future__ import annotations

from typing import Any

from gossamer.graph_types.edges.discovered_by import DiscoveredByEdge
from gossamer.graph_types.edges.links_to import LinksToEdge
from gossamer.graph_types.edges.redirects_to import RedirectsToEdge
from gossamer.graph_types.edges.serves import ServesEdge
from gossamer.graph_types.nodes.endpoint import EndpointNode
from gossamer.graph_types.nodes.host import HostNode
from gossamer.graph_types.nodes.source import SourceNode

# Register new node kinds by adding one instance to this dict.
NODE_TYPE_DEFS: dict[str, Any] = {
    HostNode.kind: HostNode(),
    EndpointNode.kind: EndpointNode(),
    SourceNode.kind: SourceNode(),
}

# Register new edge kinds here.
EDGE_TYPE_DEFS: dict[str, Any] = {
    ServesEdge.kind: ServesEdge(),
    DiscoveredByEdge.kind: DiscoveredByEdge(),
    LinksToEdge.kind: LinksToEdge(),
    RedirectsToEdge.kind: RedirectsToEdge(),
}


def node_types() -> dict[str, Any]:
    return NODE_TYPE_DEFS


def edge_types() -> dict[str, Any]:
    return EDGE_TYPE_DEFS


def graph_type_registry_payload() -> dict[str, Any]:
    nodes = {k: v.ui_hints() | {"kind": k} for k, v in NODE_TYPE_DEFS.items()}
    edges = {k: v.ui_hints() | {"kind": k} for k, v in EDGE_TYPE_DEFS.items()}
    return {"nodes": nodes, "edges": edges}
