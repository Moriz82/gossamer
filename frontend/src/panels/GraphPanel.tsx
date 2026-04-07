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
  ];
}

type Props = {
  ui: UIPrefs;
  onUiChange: (partial: Partial<UIPrefs>) => void;
  onPersistUi: () => void;
};

export default function GraphPanel({ ui, onUiChange, onPersistUi }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const uiRef = useRef(ui);
  uiRef.current = ui;

  const [selected, setSelected] = useState<GraphNode | GraphEdge | null>(null);
  const [status, setStatus] = useState<string>("");
  const [graphStats, setGraphStats] = useState<GraphStats | null>(null);
  const [enabledKinds, setEnabledKinds] = useState<Set<string>>(new Set(["Host", "Endpoint", "Form"]));
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const [typeColors, setTypeColors] = useState<Record<string, string>>({});

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
        label: `${n.kind}: ${String(n.label).slice(0, cur.label_max_len)}`,
        bg: n.color || DEFAULT_NODE_COLOR,
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
  }, [ui.label_max_len, loadGraph]);

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
      <div className="graph-sidebar">
        <div className="sidebar-section">
          <div className="sidebar-section-header">Search</div>
          <div className="sidebar-search">
            <input
              type="text"
              placeholder="Search nodes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="sidebar-search-input"
            />
            {searchQuery && (
              <button type="button" className="sidebar-search-clear" onClick={() => setSearchQuery("")}>
                &times;
              </button>
            )}
          </div>
          {searchResults.length > 0 && (
            <div className="sidebar-results">
              {searchResults.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="sidebar-result"
                  onClick={() => {
                    const cy = cyRef.current;
                    if (!cy) return;
                    const node = cy.getElementById(r.id);
                    if (node.length) {
                      cy.animate({ center: { eles: node }, zoom: 2 }, { duration: 300 });
                      node.select();
                    }
                  }}
                >
                  <span className="color-swatch" style={{ backgroundColor: r.color }} />
                  <span className="sidebar-result-kind">{r.kind}</span>
                  <span className="sidebar-result-label">{r.label}</span>
                </button>
              ))}
            </div>
          )}
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
              <input
                type="checkbox"
                checked={enabledKinds.has(kind)}
                onChange={() => {
                  setEnabledKinds(prev => {
                    const next = new Set(prev);
                    if (next.has(kind)) next.delete(kind);
                    else next.add(kind);
                    return next;
                  });
                }}
              />
              <span className="color-swatch" style={{ backgroundColor: typeColors[kind] || DEFAULT_NODE_COLOR }} />
              <span className="sidebar-filter-name">{kind}</span>
              <span className="badge">{count}</span>
            </label>
          ))}
        </div>

        <div className="sidebar-section">
          <div className="sidebar-section-header">Quick Actions</div>
          <div className="sidebar-actions">
            <button type="button" className="ghost" onClick={() => {
              setEnabledKinds(new Set(["Host"]));
            }}>Load hosts only</button>
            <button type="button" className="ghost" onClick={() => {
              if (graphStats) setEnabledKinds(new Set(Object.keys(graphStats.node_counts)));
            }}>Load full graph</button>
          </div>
        </div>
      </div>
      <div ref={containerRef} className="cy" />
      <div className="graph-inspector">
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
