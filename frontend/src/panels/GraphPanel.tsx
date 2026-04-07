import cytoscape, { type Core, type Stylesheet } from "cytoscape";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, apiJson } from "../api";

type GraphNode = {
  id: string;
  kind: string;
  label: string;
  color?: string;
  properties: Record<string, unknown>;
};

type GraphEdge = {
  id: string;
  kind: string;
  source: string;
  target: string;
  color?: string;
  properties: Record<string, unknown>;
  sources: string[];
};

export type UIPrefs = {
  graph_layout: string;
  node_size: number;
  font_size: number;
  edge_opacity: number;
  edge_width: number;
  label_max_len: number;
  wheel_sensitivity: number;
};

const LAYOUTS = ["cose", "breadthfirst", "circle", "grid", "concentric", "random"] as const;

function makeStylesheet(ui: UIPrefs): Stylesheet[] {
  return [
    {
      selector: "node",
      style: {
        label: "data(label)",
        "font-size": ui.font_size,
        color: "#e6e6e6",
        "text-outline-width": 2,
        "text-outline-color": "#111",
        width: ui.node_size,
        height: ui.node_size,
        "background-color": "data(bg)",
      },
    },
    {
      selector: "edge",
      style: {
        width: ui.edge_width,
        "line-color": "data(ec)",
        "target-arrow-color": "data(ec)",
        "target-arrow-shape": "triangle",
        "curve-style": "bezier",
        opacity: ui.edge_opacity,
      },
    },
    {
      selector: ".dimmed",
      style: {
        opacity: 0.15,
      },
    },
    {
      selector: ".path-node",
      style: {
        "border-width": 3,
        "border-color": "#b8d4e8",
        "border-opacity": 1,
        opacity: 1,
      },
    },
    {
      selector: ".path-edge",
      style: {
        width: 4,
        "line-color": "#b8d4e8",
        "target-arrow-color": "#b8d4e8",
        opacity: 1,
      },
    },
  ];
}

type Props = {
  ui: UIPrefs;
  onUiChange: (partial: Partial<UIPrefs>) => void;
  onPersistUi: () => void;
  backendType?: string;
};

export default function GraphPanel({ ui, onUiChange, onPersistUi, backendType = "sqlite" }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const uiRef = useRef(ui);
  uiRef.current = ui;

  const [selected, setSelected] = useState<GraphNode | GraphEdge | null>(null);
  const [status, setStatus] = useState<string>("");
  const [pathStart, setPathStart] = useState<{id: string; label: string} | null>(null);
  const [pathEnd, setPathEnd] = useState<{id: string; label: string} | null>(null);
  const [contextMenu, setContextMenu] = useState<{x: number; y: number; nodeId: string; nodeLabel: string} | null>(null);

  const applyStyles = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    try {
      cy.style().fromJson(makeStylesheet(uiRef.current) as unknown as cytoscape.StylesheetJson).update();
    } catch {
      /* ignore style refresh errors */
    }
  }, []);

  const labelSkipRef = useRef(false);

  const loadGraph = useCallback(async () => {
    const cy = cyRef.current;
    if (!cy) return;
    const cur = uiRef.current;
    const r = await apiFetch("/api/graph");
    if (!r.ok) {
      setStatus("Failed to load graph");
      return;
    }
    const data = (await r.json()) as { nodes: GraphNode[]; edges: GraphEdge[] };
    const nodes = data.nodes.map((n) => ({
      data: {
        id: n.id,
        label: `${n.kind}: ${String(n.label).slice(0, cur.label_max_len)}`,
        bg: n.color || "#888",
        kind: n.kind,
        props: n.properties,
      },
    }));
    const edges = data.edges.map((e) => ({
      data: {
        id: e.id,
        source: e.source,
        target: e.target,
        ec: e.color || "#666",
        kind: e.kind,
      },
    }));
    cy.elements().remove();
    cy.add([...nodes, ...edges]);
    cy.layout({ name: cur.graph_layout as cytoscape.LayoutOptions["name"], animate: false }).run();
    cy.fit(undefined, 24);
    setStatus(`${data.nodes.length} nodes, ${data.edges.length} edges`);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let cancelled = false;
    let cy: Core;
    try {
      cy = cytoscape({
        container: el,
        elements: [],
        style: makeStylesheet(uiRef.current),
        layout: { name: uiRef.current.graph_layout, animate: false },
        wheelSensitivity: uiRef.current.wheel_sensitivity,
      });
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to init graph");
      return;
    }
    cyRef.current = cy;

    cy.on("tap", "node", (evt) => {
      const n = evt.target.data() as GraphNode & { bg?: string; props?: Record<string, unknown> };
      setSelected({
        id: String(n.id),
        kind: String(n.kind),
        label: String(n.label),
        properties: n.props || {},
      });
    });
    cy.on("tap", "edge", (evt) => {
      const ed = evt.target.data();
      setSelected({
        id: String(ed.id),
        kind: String(ed.kind),
        label: String(ed.kind),
        source: String(ed.source),
        target: String(ed.target),
        properties: {},
        sources: [],
      } as GraphEdge);
    });

    cy.on("cxttap", "node", (evt) => {
      const node = evt.target;
      const data = node.data();
      const rp = node.renderedPosition();
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      setContextMenu({
        x: rp.x + rect.left,
        y: rp.y + rect.top,
        nodeId: data.id,
        nodeLabel: String(data.label || data.kind),
      });
    });

    cy.on("tap", () => setContextMenu(null));

    loadGraph().finally(() => {
      if (cancelled) return;
    });

    return () => {
      cancelled = true;
      cy.destroy();
      cyRef.current = null;
    };
  }, [loadGraph]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    applyStyles();
  }, [ui, applyStyles]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || cy.elements().length === 0) return;
    cy.layout({ name: ui.graph_layout as cytoscape.LayoutOptions["name"], animate: false }).run();
    cy.fit(undefined, 24);
  }, [ui.graph_layout]);

  useEffect(() => {
    if (!labelSkipRef.current) {
      labelSkipRef.current = true;
      return;
    }
    void loadGraph();
  }, [ui.label_max_len, loadGraph]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    const clickHandler = () => setContextMenu(null);
    document.addEventListener("keydown", handler);
    document.addEventListener("click", clickHandler);
    return () => {
      document.removeEventListener("keydown", handler);
      document.removeEventListener("click", clickHandler);
    };
  }, []);

  async function showNeighbors(nodeId: string) {
    const cy = cyRef.current;
    if (!cy) return;
    try {
      const data = await apiJson<{inbound: Record<string, any[]>; outbound: Record<string, any[]>}>(`/api/nodes/${encodeURIComponent(nodeId)}/neighbors?direction=both`);
      let added = 0;
      const allNodes: any[] = [];
      const allEdges: any[] = [];

      for (const [, neighbors] of [...Object.entries(data.inbound || {}), ...Object.entries(data.outbound || {})]) {
        for (const n of neighbors) {
          if (!cy.getElementById(n.id).length) {
            allNodes.push({ data: { id: n.id, label: n.label || n.kind, bg: n.color || "#888", kind: n.kind, props: n.properties, size: 18 } });
            added++;
          }
          if (n.edge_id && !cy.getElementById(n.edge_id).length) {
            allEdges.push({ data: { id: n.edge_id, source: n.edge_source || nodeId, target: n.edge_target || n.id, ec: n.edge_color || "#666", kind: n.edge_kind || "" } });
          }
        }
      }

      if (allNodes.length || allEdges.length) {
        cy.add([...allNodes, ...allEdges]);
        const newEles = cy.collection(allNodes.map(n => cy.getElementById(n.data.id)));
        if (newEles.length) {
          newEles.layout({ name: "cose", animate: true, animationDuration: 300, fit: false }).run();
        }
      }
      setStatus(`Added ${added} neighbors`);
    } catch (e) {
      setStatus(`Failed to load neighbors: ${e instanceof Error ? e.message : String(e)}`);
    }
    setContextMenu(null);
  }

  async function findPath() {
    if (!pathStart || !pathEnd) return;
    const cy = cyRef.current;
    if (!cy) return;
    try {
      const data = await apiJson<{nodes: any[]; edges: any[]}>("/api/graph/path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from_id: pathStart.id, to_id: pathEnd.id }),
      });

      if (!data.nodes.length) {
        setStatus("No path found between these nodes");
        return;
      }

      cy.elements().addClass("dimmed");

      const pathNodeIds = new Set(data.nodes.map((n: any) => n.id));
      const pathEdgeIds = new Set(data.edges.map((e: any) => e.id));

      cy.nodes().forEach(node => {
        if (pathNodeIds.has(node.id())) {
          node.removeClass("dimmed").addClass("path-node");
        }
      });
      cy.edges().forEach(edge => {
        if (pathEdgeIds.has(edge.id())) {
          edge.removeClass("dimmed").addClass("path-edge");
        }
      });

      const pathEles = cy.elements(".path-node, .path-edge");
      if (pathEles.length) {
        cy.animate({ fit: { eles: pathEles, padding: 40 } }, { duration: 300 });
      }

      setStatus(`Path: ${data.nodes.length} nodes, ${data.edges.length} edges`);
    } catch (e) {
      setStatus(`Path query failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function clearPath() {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().removeClass("dimmed path-node path-edge");
    setPathStart(null);
    setPathEnd(null);
  }

  return (
    <div className="graph-panel">
      <div className="graph-toolbar panel-toolbar">
        <div className="toolbar-group">
          <button type="button" onClick={() => void loadGraph()}>
            Refresh graph
          </button>
          <button
            type="button"
            onClick={() => {
              cyRef.current?.fit(undefined, 24);
            }}
          >
            Fit
          </button>
        </div>
        <label className="inline">
          Layout
          <select
            value={ui.graph_layout}
            onChange={(e) => onUiChange({ graph_layout: e.target.value })}
          >
            {LAYOUTS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <div className="toolbar-group">
          <label className="inline">
            Node size
            <input
              type="range"
              min={8}
              max={48}
              step={1}
              value={ui.node_size}
              onChange={(e) => onUiChange({ node_size: Number(e.target.value) })}
            />
          </label>
          <label className="inline">
            Font
            <input
              type="range"
              min={6}
              max={16}
              step={1}
              value={ui.font_size}
              onChange={(e) => onUiChange({ font_size: Number(e.target.value) })}
            />
          </label>
          <label className="inline">
            Edge W
            <input
              type="range"
              min={0.5}
              max={4}
              step={0.25}
              value={ui.edge_width}
              onChange={(e) => onUiChange({ edge_width: Number(e.target.value) })}
            />
          </label>
          <label className="inline">
            Edge α
            <input
              type="range"
              min={0.2}
              max={1}
              step={0.05}
              value={ui.edge_opacity}
              onChange={(e) => onUiChange({ edge_opacity: Number(e.target.value) })}
            />
          </label>
        </div>
        <div className="toolbar-group">
          <label className="inline">
            Label len
            <input
              type="range"
              min={12}
              max={80}
              step={1}
              value={ui.label_max_len}
              onChange={(e) => onUiChange({ label_max_len: Number(e.target.value) })}
            />
          </label>
          <label className="inline">
            Zoom wheel
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={ui.wheel_sensitivity}
              onChange={(e) => onUiChange({ wheel_sensitivity: Number(e.target.value) })}
            />
          </label>
        </div>
        <button type="button" className="primary" onClick={onPersistUi}>
          Save UI prefs
        </button>
        <span className="toolbar-status">{status}</span>
      </div>
      <div ref={containerRef} className="cy" />
      {contextMenu && (
        <div className="graph-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => { setPathStart({ id: contextMenu.nodeId, label: contextMenu.nodeLabel }); setContextMenu(null); }}>
            Set as path start
          </button>
          <button type="button" onClick={() => { setPathEnd({ id: contextMenu.nodeId, label: contextMenu.nodeLabel }); setContextMenu(null); }}>
            Set as path end
          </button>
          <button type="button" onClick={() => void showNeighbors(contextMenu.nodeId)}>
            Show neighbors
          </button>
          <hr />
          <button type="button" onClick={() => { cyRef.current?.getElementById(contextMenu.nodeId)?.style("display", "none"); setContextMenu(null); }}>
            Hide node
          </button>
          <button type="button" onClick={() => { navigator.clipboard.writeText(contextMenu.nodeId); setContextMenu(null); }}>
            Copy ID
          </button>
        </div>
      )}
      <div className="graph-inspector">
        <h3>Path Finder</h3>
        {backendType === "sqlite" ? (
          <p className="sidebar-hint">Path queries require Neo4j backend</p>
        ) : (
          <div className="path-finder">
            <div className="path-node-display">
              <span className="path-label">Start:</span>
              {pathStart ? (
                <span className="path-node-name">{pathStart.label}</span>
              ) : (
                <span className="path-node-placeholder">Right-click a node</span>
              )}
            </div>
            <div className="path-node-display">
              <span className="path-label">End:</span>
              {pathEnd ? (
                <span className="path-node-name">{pathEnd.label}</span>
              ) : (
                <span className="path-node-placeholder">Right-click a node</span>
              )}
            </div>
            <div className="path-actions">
              <button type="button" className="primary" onClick={() => void findPath()} disabled={!pathStart || !pathEnd}>
                Find path
              </button>
              <button type="button" className="ghost" onClick={clearPath}>
                Clear
              </button>
            </div>
          </div>
        )}
        <h3>Selection</h3>
        {!selected ? (
          <p className="inspector-empty">Tap a node or edge</p>
        ) : (
          <>
            <div className="inspector-header">
              <span className="inspector-kind">{selected.kind}</span>
            </div>
            <div className="inspector-label">
              {"label" in selected ? String((selected as { label: string }).label) : selected.kind}
            </div>
            <div className="inspector-id">{selected.id}</div>
            {"source" in selected && (
              <div className="inspector-edge-endpoints">
                {(selected as { source: string; target: string }).source} &rarr; {(selected as { source: string; target: string }).target}
              </div>
            )}
            {Object.keys(selected.properties).length > 0 && (
              <div className="inspector-props">
                {Object.entries(selected.properties).map(([k, v]) => (
                  <div key={k} className="inspector-prop">
                    <span className="inspector-prop-key">{k}</span>
                    <span className="inspector-prop-val">{String(v)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
