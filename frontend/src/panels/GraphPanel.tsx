import cytoscape, { type Core, type Stylesheet } from "cytoscape";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, apiJson } from "../api";

const DEFAULT_NODE_COLOR = "#888";

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

type SearchHit = { id: string; kind: string; label: string; color: string };

type GraphStats = {
  node_counts: Record<string, number>;
  edge_counts: Record<string, number>;
  total_nodes: number;
  total_edges: number;
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

type LabelMode = "smart" | "full" | "hidden" | "kind";

const LAYOUTS = ["cose", "breadthfirst", "circle", "grid", "concentric", "random"] as const;

const NODE_KINDS = ["Host", "Endpoint", "Form", "Finding", "Source"];
const EDGE_KINDS = ["serves", "discovered_by", "links_to", "redirects_to", "contains_form", "submits_to", "found_on"];
const OPERATORS = ["equals", "contains", "starts_with", "gt", "lt", "is_null", "is_not_null"];

function smartLabel(kind: string, props: Record<string, unknown>, mode: LabelMode, maxLen: number): string {
  if (mode === "hidden") return "";
  if (mode === "kind") return kind;

  const url = String(props.url || props.action_url || "");
  const hostname = String(props.hostname || "");
  const name = String(props.name || "");

  if (mode === "full") {
    const full = url || hostname || name || kind;
    return `${kind}: ${full}`;
  }

  switch (kind) {
    case "Endpoint": {
      if (!url) return kind;
      try {
        const u = new URL(url);
        const path = u.pathname + (u.search ? u.search.slice(0, 20) : "");
        return path.length > maxLen ? path.slice(0, maxLen) + "..." : path;
      } catch {
        return url.slice(0, maxLen);
      }
    }
    case "Host":
      return hostname || kind;
    case "Finding":
      return name ? (name.length > 25 ? name.slice(0, 25) + "..." : name) : "Finding";
    case "Form": {
      const method = String(props.method || "GET");
      if (!url) return `${method} form`;
      try {
        return `${method} ${new URL(url).pathname}`;
      } catch {
        return `${method} ${url.slice(0, 20)}`;
      }
    }
    case "Source":
      return name || "Source";
    default:
      return kind;
  }
}

function makeStylesheet(ui: UIPrefs): Stylesheet[] {
  return [
    {
      selector: "node",
      style: {
        label: "data(label)",
        "font-size": ui.font_size,
        "min-zoomed-font-size": 12,
        color: "#e6e6e6",
        "text-outline-width": 2,
        "text-outline-color": "#111",
        width: "data(size)",
        height: "data(size)",
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
      style: { opacity: 0.12 },
    },
    {
      selector: ".highlighted",
      style: {
        "border-width": 3,
        "border-color": "#b8d4e8",
        "border-opacity": 1,
      },
    },
    {
      selector: ".path-node",
      style: { "border-width": 3, "border-color": "#b8d4e8", "border-opacity": 1, opacity: 1 },
    },
    {
      selector: ".path-edge",
      style: { width: 4, "line-color": "#b8d4e8", "target-arrow-color": "#b8d4e8", opacity: 1 },
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
  const [labelMode, setLabelMode] = useState<LabelMode>("smart");
  const labelModeRef = useRef(labelMode);
  labelModeRef.current = labelMode;
  const [graphStats, setGraphStats] = useState<GraphStats | null>(null);
  const [enabledKinds, setEnabledKinds] = useState<Set<string>>(new Set(["Host", "Endpoint", "Form"]));
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const [typeColors, setTypeColors] = useState<Record<string, string>>({});
  const [tooltip, setTooltip] = useState<{x: number; y: number; label: string; kind: string} | null>(null);
  const [pathStart, setPathStart] = useState<{id: string; label: string} | null>(null);
  const [pathEnd, setPathEnd] = useState<{id: string; label: string} | null>(null);
  const [contextMenu, setContextMenu] = useState<{x: number; y: number; nodeId: string; nodeLabel: string} | null>(null);
  const [graphEmpty, setGraphEmpty] = useState(false);
  const [queryLoading, setQueryLoading] = useState(false);
  const [showCustomQuery, setShowCustomQuery] = useState(false);
  const [customTab, setCustomTab] = useState<"visual" | "raw">("visual");
  const [builderKind, setBuilderKind] = useState("Endpoint");
  const [builderFilters, setBuilderFilters] = useState<{property: string; operator: string; value: string}[]>([]);
  const [builderRel, setBuilderRel] = useState<{edge_kind: string; direction: string}[]>([]);
  const [rawSql, setRawSql] = useState("");
  const [rawHistory, setRawHistory] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("gossamer_raw_history") || "[]"); } catch { return []; }
  });

  const applyStyles = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    try {
      cy.style().fromJson(makeStylesheet(uiRef.current) as unknown as cytoscape.StylesheetJson).update();
    } catch {
      /* ignore style refresh errors */
    }
  }, []);

  useEffect(() => {
    apiJson<GraphStats>("/api/graph/stats").then(setGraphStats).catch(() => {});
    apiJson<{nodes: Record<string, {color?: string}>}>("/api/graph-type-registry")
      .then(reg => {
        const colors: Record<string, string> = {};
        for (const [kind, hints] of Object.entries(reg.nodes)) {
          colors[kind] = hints.color || DEFAULT_NODE_COLOR;
        }
        setTypeColors(colors);
      }).catch(() => {});
  }, []);

  const labelSkipRef = useRef(false);

  const loadGraph = useCallback(async () => {
    const cy = cyRef.current;
    if (!cy) return;
    const cur = uiRef.current;

    const params = new URLSearchParams();
    if (enabledKinds.size > 0) {
      params.set("kinds", Array.from(enabledKinds).join(","));
    }

    const r = await apiFetch(`/api/graph?${params}`);
    if (!r.ok) {
      setStatus("Failed to load graph");
      return;
    }
    const data = (await r.json()) as { nodes: GraphNode[]; edges: GraphEdge[] };
    const nodes = data.nodes.map((n) => ({
      data: {
        id: n.id,
        label: smartLabel(n.kind, n.properties, labelModeRef.current, cur.label_max_len),
        bg: n.color || DEFAULT_NODE_COLOR,
        kind: n.kind,
        props: n.properties,
        size: n.kind === "Host" ? cur.node_size * 1.4 : n.kind === "Source" ? cur.node_size * 0.7 : cur.node_size,
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
  }, [enabledKinds]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let cy: Core;
    try {
      cy = cytoscape({
        container: el,
        elements: [],
        style: makeStylesheet(uiRef.current),
        layout: { name: uiRef.current.graph_layout, animate: false },
        wheelSensitivity: uiRef.current.wheel_sensitivity,
        minZoom: 0.1,
        maxZoom: 4,
        boxSelectionEnabled: true,
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

    cy.on("mouseover", "node", (evt) => {
      const node = evt.target;
      const pos = node.renderedPosition();
      const data = node.data();
      setTooltip({
        x: pos.x,
        y: pos.y - 20,
        label: String(data.props?.url || data.props?.hostname || data.props?.name || data.label || ""),
        kind: data.kind,
      });
    });
    cy.on("mouseout", "node", () => setTooltip(null));
    cy.on("cxttap", "node", (evt) => {
      const node = evt.target;
      const data = node.data();
      const rp = node.renderedPosition();
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      setContextMenu({ x: rp.x + rect.left, y: rp.y + rect.top, nodeId: data.id, nodeLabel: String(data.label || data.kind) });
    });
    cy.on("tap", () => setContextMenu(null));

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadGraph();
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
  }, [ui.label_max_len, labelMode, loadGraph]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      cyRef.current?.elements().removeClass("dimmed highlighted");
      return;
    }
    const cy = cyRef.current;
    if (!cy) return;
    const q = searchQuery.toLowerCase();
    const matches: SearchHit[] = [];
    cy.nodes().forEach(node => {
      const data = node.data();
      const label = String(data.label || "").toLowerCase();
      const kind = String(data.kind || "").toLowerCase();
      const id = String(data.id || "").toLowerCase();
      if (label.includes(q) || kind.includes(q) || id.includes(q)) {
        matches.push({id: data.id, kind: data.kind, label: data.label, color: data.bg || DEFAULT_NODE_COLOR});
        node.addClass("highlighted");
        node.removeClass("dimmed");
      } else {
        node.addClass("dimmed");
        node.removeClass("highlighted");
      }
    });
    setSearchResults(matches.slice(0, 50));
  }, [searchQuery]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setContextMenu(null); };
    const clickHandler = () => setContextMenu(null);
    document.addEventListener("keydown", handler);
    document.addEventListener("click", clickHandler);
    return () => { document.removeEventListener("keydown", handler); document.removeEventListener("click", clickHandler); };
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
            allNodes.push({ data: { id: n.id, label: n.label || n.kind, bg: n.color || DEFAULT_NODE_COLOR, kind: n.kind, props: n.properties, size: 18 } });
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
        if (newEles.length) newEles.layout({ name: "cose", animate: true, animationDuration: 300, fit: false }).run();
      }
      setStatus(`Added ${added} neighbors`);
    } catch (e) {
      setStatus(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    setContextMenu(null);
  }

  async function findPath() {
    if (!pathStart || !pathEnd) return;
    const cy = cyRef.current;
    if (!cy) return;
    try {
      const data = await apiJson<{nodes: any[]; edges: any[]}>("/api/graph/path", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from_id: pathStart.id, to_id: pathEnd.id }),
      });
      if (!data.nodes.length) { setStatus("No path found"); return; }
      cy.elements().addClass("dimmed");
      const pathNodeIds = new Set(data.nodes.map((n: any) => n.id));
      const pathEdgeIds = new Set(data.edges.map((e: any) => e.id));
      cy.nodes().forEach(node => { if (pathNodeIds.has(node.id())) node.removeClass("dimmed").addClass("path-node"); });
      cy.edges().forEach(edge => { if (pathEdgeIds.has(edge.id())) edge.removeClass("dimmed").addClass("path-edge"); });
      const pathEles = cy.elements(".path-node, .path-edge");
      if (pathEles.length) cy.animate({ fit: { eles: pathEles, padding: 40 } }, { duration: 300 });
      setStatus(`Path: ${data.nodes.length} nodes, ${data.edges.length} edges`);
    } catch (e) {
      setStatus(`Path failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function clearPath() {
    cyRef.current?.elements().removeClass("dimmed path-node path-edge");
    setPathStart(null);
    setPathEnd(null);
  }

  async function runVisualQuery() {
    const cy = cyRef.current;
    if (!cy) return;
    setQueryLoading(true);
    try {
      const body = { node_kind: builderKind, filters: builderFilters, relationships: builderRel };
      const data = await apiJson<{nodes: GraphNode[]; edges: GraphEdge[]}>("/api/graph/query/build", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const cur = uiRef.current;
      const nodes = data.nodes.map((n) => ({ data: { id: n.id, label: smartLabel(n.kind, n.properties, labelModeRef.current, cur.label_max_len), bg: n.color || DEFAULT_NODE_COLOR, kind: n.kind, props: n.properties, size: n.kind === "Host" ? cur.node_size * 1.4 : cur.node_size } }));
      const edges = data.edges.map((e) => ({ data: { id: e.id, source: e.source, target: e.target, ec: e.color || "#666", kind: e.kind } }));
      cy.elements().remove();
      cy.add([...nodes, ...edges]);
      cy.layout({ name: cur.graph_layout as cytoscape.LayoutOptions["name"], animate: false }).run();
      cy.fit(undefined, 24);
      setStatus(`${data.nodes.length} nodes, ${data.edges.length} edges — custom query`);
      setGraphEmpty(data.nodes.length === 0);
      setShowCustomQuery(false);
    } catch (e) { setStatus(`Query failed: ${e instanceof Error ? e.message : String(e)}`); } finally { setQueryLoading(false); }
  }

  async function runRawQuery() {
    const cy = cyRef.current;
    if (!cy || !rawSql.trim()) return;
    setQueryLoading(true);
    try {
      const data = await apiJson<{nodes: GraphNode[]; edges: GraphEdge[]}>("/api/graph/query/raw", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sql: rawSql }),
      });
      const cur = uiRef.current;
      const nodes = data.nodes.map((n) => ({ data: { id: n.id, label: smartLabel(n.kind, n.properties, labelModeRef.current, cur.label_max_len), bg: n.color || DEFAULT_NODE_COLOR, kind: n.kind, props: n.properties, size: n.kind === "Host" ? cur.node_size * 1.4 : cur.node_size } }));
      const edges = data.edges.map((e) => ({ data: { id: e.id, source: e.source, target: e.target, ec: e.color || "#666", kind: e.kind } }));
      cy.elements().remove();
      cy.add([...nodes, ...edges]);
      cy.layout({ name: cur.graph_layout as cytoscape.LayoutOptions["name"], animate: false }).run();
      cy.fit(undefined, 24);
      setStatus(`${data.nodes.length} nodes, ${data.edges.length} edges — raw SQL`);
      setGraphEmpty(data.nodes.length === 0);
      const history = [rawSql, ...rawHistory.filter(h => h !== rawSql)].slice(0, 10);
      setRawHistory(history);
      localStorage.setItem("gossamer_raw_history", JSON.stringify(history));
      setShowCustomQuery(false);
    } catch (e) { setStatus(`Query failed: ${e instanceof Error ? e.message : String(e)}`); } finally { setQueryLoading(false); }
  }

  return (
    <div className="graph-panel">
      <div className="graph-toolbar panel-toolbar">
        <div className="toolbar-group">
          <button type="button" onClick={() => void loadGraph()}>
            Refresh
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
        <label className="inline">
          Labels
          <select value={labelMode} onChange={(e) => setLabelMode(e.target.value as LabelMode)}>
            <option value="smart">Smart</option>
            <option value="full">Full</option>
            <option value="kind">Kind only</option>
            <option value="hidden">Hidden</option>
          </select>
        </label>
        <label className="inline">
          Label len
          <input type="range" min={12} max={80} step={1} value={ui.label_max_len}
            onChange={(e) => onUiChange({ label_max_len: Number(e.target.value) })} />
        </label>
        <label className="inline">
          Zoom
          <input type="range" min={0.05} max={1} step={0.05} value={ui.wheel_sensitivity}
            onChange={(e) => onUiChange({ wheel_sensitivity: Number(e.target.value) })} />
        </label>
        <details className="toolbar-details">
          <summary>Display</summary>
          <div className="toolbar-details-content">
            <label className="inline">Node size
              <input type="range" min={8} max={48} step={1} value={ui.node_size}
                onChange={(e) => onUiChange({ node_size: Number(e.target.value) })} />
            </label>
            <label className="inline">Font
              <input type="range" min={6} max={16} step={1} value={ui.font_size}
                onChange={(e) => onUiChange({ font_size: Number(e.target.value) })} />
            </label>
            <label className="inline">Edge W
              <input type="range" min={0.5} max={4} step={0.25} value={ui.edge_width}
                onChange={(e) => onUiChange({ edge_width: Number(e.target.value) })} />
            </label>
            <label className="inline">Edge alpha
              <input type="range" min={0.2} max={1} step={0.05} value={ui.edge_opacity}
                onChange={(e) => onUiChange({ edge_opacity: Number(e.target.value) })} />
            </label>
          </div>
        </details>
        <button type="button" className="primary" onClick={onPersistUi}>
          Save UI prefs
        </button>
        <span className="toolbar-status">{status}{graphEmpty ? " (empty)" : ""}</span>
      </div>
      <div className="graph-sidebar">
        <div className="sidebar-section">
          <div className="sidebar-section-header">Search</div>
          <div className="sidebar-search">
            <input type="text" placeholder="Search nodes..." value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)} className="sidebar-search-input" />
            {searchQuery && (
              <button type="button" className="sidebar-search-clear" onClick={() => setSearchQuery("")}>&times;</button>
            )}
          </div>
          {searchResults.length > 0 && (
            <div className="sidebar-results">
              {searchResults.map((r) => (
                <button key={r.id} type="button" className="sidebar-result"
                  onClick={() => {
                    const cy = cyRef.current;
                    if (!cy) return;
                    const node = cy.getElementById(r.id);
                    if (node.length) { cy.animate({ center: { eles: node }, zoom: 2 }, { duration: 300 }); node.select(); }
                  }}>
                  <span className="color-swatch" style={{ backgroundColor: r.color }} />
                  <span className="sidebar-result-kind">{r.kind}</span>
                  <span className="sidebar-result-label">{r.label}</span>
                </button>
              ))}
            </div>
          )}
          <div style={{ padding: "0 12px" }}>
            <button type="button" className="sidebar-custom-query-btn" onClick={() => setShowCustomQuery(true)}>Custom Query</button>
          </div>
        </div>
        <div className="sidebar-section">
          <div className="sidebar-section-header">
            Node Types
            <button type="button" className="sidebar-toggle-all" onClick={() => {
              if (graphStats) {
                const allKinds = Object.keys(graphStats.node_counts);
                setEnabledKinds(prev => prev.size === allKinds.length ? new Set() : new Set(allKinds));
              }
            }}>
              {enabledKinds.size === Object.keys(graphStats?.node_counts || {}).length ? "None" : "All"}
            </button>
          </div>
          {graphStats && Object.entries(graphStats.node_counts).map(([kind, count]) => (
            <label key={kind} className="sidebar-filter">
              <input type="checkbox" checked={enabledKinds.has(kind)}
                onChange={() => { setEnabledKinds(prev => { const next = new Set(prev); if (next.has(kind)) next.delete(kind); else next.add(kind); return next; }); }} />
              <span className="color-swatch" style={{ backgroundColor: typeColors[kind] || DEFAULT_NODE_COLOR }} />
              <span className="sidebar-filter-name">{kind}</span>
              <span className="badge">{count}</span>
            </label>
          ))}
        </div>
        <div className="sidebar-section">
          <div className="sidebar-section-header">Quick Actions</div>
          <div className="sidebar-actions">
            <button type="button" className="ghost" onClick={() => setEnabledKinds(new Set(["Host"]))}>Load hosts only</button>
            <button type="button" className="ghost" onClick={() => { if (graphStats) setEnabledKinds(new Set(Object.keys(graphStats.node_counts))); }}>Load full graph</button>
          </div>
        </div>
        <div className="sidebar-section">
          <div className="sidebar-section-header">Path Finder</div>
          {backendType === "sqlite" ? (
            <p className="sidebar-hint">Path queries require Neo4j</p>
          ) : (
            <div className="path-finder">
              <div className="path-node-display"><span className="path-label">Start:</span>{pathStart ? <span className="path-node-name">{pathStart.label}</span> : <span className="path-node-placeholder">Right-click node</span>}</div>
              <div className="path-node-display"><span className="path-label">End:</span>{pathEnd ? <span className="path-node-name">{pathEnd.label}</span> : <span className="path-node-placeholder">Right-click node</span>}</div>
              <div className="path-actions">
                <button type="button" className="primary" onClick={() => void findPath()} disabled={!pathStart || !pathEnd}>Find path</button>
                <button type="button" className="ghost" onClick={clearPath}>Clear</button>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="graph-canvas-wrap">
        <div ref={containerRef} className="cy" />
        {tooltip && (
          <div className="graph-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
            <span className="graph-tooltip-kind">{tooltip.kind}</span>
            <span className="graph-tooltip-label">{tooltip.label}</span>
          </div>
        )}
      </div>
      {contextMenu && (
        <div className="graph-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => { setPathStart({ id: contextMenu.nodeId, label: contextMenu.nodeLabel }); setContextMenu(null); }}>Set as path start</button>
          <button type="button" onClick={() => { setPathEnd({ id: contextMenu.nodeId, label: contextMenu.nodeLabel }); setContextMenu(null); }}>Set as path end</button>
          <button type="button" onClick={() => void showNeighbors(contextMenu.nodeId)}>Show neighbors</button>
          <hr />
          <button type="button" onClick={() => { cyRef.current?.getElementById(contextMenu.nodeId)?.style("display", "none"); setContextMenu(null); }}>Hide node</button>
          <button type="button" onClick={() => { navigator.clipboard.writeText(contextMenu.nodeId); setContextMenu(null); }}>Copy ID</button>
        </div>
      )}
      <div className="graph-inspector">
        <h3 className="inspector-title">Inspector</h3>
        {!selected ? (
          <p className="inspector-empty inspector-body">Select a node or edge</p>
        ) : (
          <div className="inspector-body">
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
          </div>
        )}
      </div>
      {showCustomQuery && (
        <div className="query-modal-overlay" onClick={() => setShowCustomQuery(false)}>
          <div className="query-modal" onClick={(e) => e.stopPropagation()}>
            <div className="query-modal-header">
              <h3>Custom Query</h3>
              <button type="button" className="ghost" onClick={() => setShowCustomQuery(false)}>&times;</button>
            </div>
            <div className="query-modal-tabs">
              <button type="button" className={customTab === "visual" ? "sidebar-tab active" : "sidebar-tab"} onClick={() => setCustomTab("visual")}>Visual Builder</button>
              <button type="button" className={customTab === "raw" ? "sidebar-tab active" : "sidebar-tab"} onClick={() => setCustomTab("raw")}>Raw SQL</button>
            </div>
            {customTab === "visual" ? (
              <div className="query-builder">
                <label>Show <select value={builderKind} onChange={(e) => setBuilderKind(e.target.value)}>
                  {NODE_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
                </select></label>
                <div className="builder-section">
                  <div className="builder-section-header">Where <button type="button" className="ghost" onClick={() => setBuilderFilters([...builderFilters, {property: "", operator: "equals", value: ""}])}>+ Add</button></div>
                  {builderFilters.map((f, i) => (
                    <div key={i} className="builder-filter-row">
                      <input placeholder="property" value={f.property} onChange={(e) => { const next = [...builderFilters]; next[i] = {...f, property: e.target.value}; setBuilderFilters(next); }} />
                      <select value={f.operator} onChange={(e) => { const next = [...builderFilters]; next[i] = {...f, operator: e.target.value}; setBuilderFilters(next); }}>
                        {OPERATORS.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                      {!["is_null","is_not_null"].includes(f.operator) && <input placeholder="value" value={f.value} onChange={(e) => { const next = [...builderFilters]; next[i] = {...f, value: e.target.value}; setBuilderFilters(next); }} />}
                      <button type="button" className="ghost" onClick={() => setBuilderFilters(builderFilters.filter((_, j) => j !== i))}>&times;</button>
                    </div>
                  ))}
                </div>
                <div className="builder-section">
                  <div className="builder-section-header">Connected to <button type="button" className="ghost" onClick={() => setBuilderRel([...builderRel, {edge_kind: "serves", direction: "out"}])}>+ Add</button></div>
                  {builderRel.map((r, i) => (
                    <div key={i} className="builder-filter-row">
                      <select value={r.edge_kind} onChange={(e) => { const next = [...builderRel]; next[i] = {...r, edge_kind: e.target.value}; setBuilderRel(next); }}>
                        {EDGE_KINDS.map(ek => <option key={ek} value={ek}>{ek}</option>)}
                      </select>
                      <select value={r.direction} onChange={(e) => { const next = [...builderRel]; next[i] = {...r, direction: e.target.value}; setBuilderRel(next); }}>
                        <option value="in">Inbound</option>
                        <option value="out">Outbound</option>
                      </select>
                      <button type="button" className="ghost" onClick={() => setBuilderRel(builderRel.filter((_, j) => j !== i))}>&times;</button>
                    </div>
                  ))}
                </div>
                <button type="button" className="primary" onClick={() => void runVisualQuery()} disabled={queryLoading}>{queryLoading ? "Running..." : "Run Query"}</button>
              </div>
            ) : (
              <div className="query-raw">
                <textarea value={rawSql} onChange={(e) => setRawSql(e.target.value)} placeholder="SELECT id, kind, key, properties_json FROM nodes WHERE kind='Endpoint' LIMIT 50" rows={6} className="raw-sql-input" />
                {rawHistory.length > 0 && (
                  <div className="raw-history">
                    <span className="muted">Recent:</span>
                    {rawHistory.map((h, i) => (
                      <button key={i} type="button" className="ghost raw-history-item" onClick={() => setRawSql(h)}>{h.slice(0, 60)}...</button>
                    ))}
                  </div>
                )}
                <button type="button" className="primary" onClick={() => void runRawQuery()} disabled={queryLoading || !rawSql.trim()}>{queryLoading ? "Running..." : "Run SQL"}</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
