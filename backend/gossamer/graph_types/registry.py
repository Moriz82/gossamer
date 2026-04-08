from __future__ import annotations

from typing import Any

from gossamer.graph_types.edges.contains_form import ContainsFormEdge
from gossamer.graph_types.edges.discovered_by import DiscoveredByEdge
from gossamer.graph_types.edges.found_on import FoundOnEdge
from gossamer.graph_types.edges.links_to import LinksToEdge
from gossamer.graph_types.edges.redirects_to import RedirectsToEdge
from gossamer.graph_types.edges.serves import ServesEdge
from gossamer.graph_types.edges.submits_to import SubmitsToEdge
from gossamer.graph_types.edges.runs import RunsEdge
from gossamer.graph_types.edges.detected_on import DetectedOnEdge
from gossamer.graph_types.nodes.endpoint import EndpointNode
from gossamer.graph_types.nodes.finding import FindingNode
from gossamer.graph_types.nodes.form import FormNode
from gossamer.graph_types.nodes.host import HostNode
from gossamer.graph_types.nodes.source import SourceNode
from gossamer.graph_types.nodes.technology import TechnologyNode

# Register new node kinds by adding one instance to this dict.
NODE_TYPE_DEFS: dict[str, Any] = {
    HostNode.kind: HostNode(),
    EndpointNode.kind: EndpointNode(),
    FormNode.kind: FormNode(),
    FindingNode.kind: FindingNode(),
    SourceNode.kind: SourceNode(),
    TechnologyNode.kind: TechnologyNode(),
}

# Register new edge kinds here.
EDGE_TYPE_DEFS: dict[str, Any] = {
    ServesEdge.kind: ServesEdge(),
    DiscoveredByEdge.kind: DiscoveredByEdge(),
    LinksToEdge.kind: LinksToEdge(),
    RedirectsToEdge.kind: RedirectsToEdge(),
    ContainsFormEdge.kind: ContainsFormEdge(),
    SubmitsToEdge.kind: SubmitsToEdge(),
    FoundOnEdge.kind: FoundOnEdge(),
    RunsEdge.kind: RunsEdge(),
    DetectedOnEdge.kind: DetectedOnEdge(),
}


def node_types() -> dict[str, Any]:
    return NODE_TYPE_DEFS


def edge_types() -> dict[str, Any]:
    return EDGE_TYPE_DEFS


def graph_type_registry_payload() -> dict[str, Any]:
    nodes = {k: v.ui_hints() | {"kind": k} for k, v in NODE_TYPE_DEFS.items()}
    edges = {k: v.ui_hints() | {"kind": k} for k, v in EDGE_TYPE_DEFS.items()}
    return {"nodes": nodes, "edges": edges}
