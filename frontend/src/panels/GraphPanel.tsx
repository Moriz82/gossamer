import cytoscape, { type Core, type Stylesheet } from "cytoscape";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../api";

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

type LabelMode = "smart" | "full" | "hidden" | "kind";

const LAYOUTS = ["cose", "breadthfirst", "circle", "grid", "concentric", "random"] as const;

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
  const [labelMode, setLabelMode] = useState<LabelMode>("smart");
  const labelModeRef = useRef(labelMode);
  labelModeRef.current = labelMode;
  const [tooltip, setTooltip] = useState<{x: number; y: number; label: string; kind: string} | null>(null);

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
        label: smartLabel(n.kind, n.properties, labelModeRef.current, cur.label_max_len),
        bg: n.color || "#888",
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
  }, [ui.label_max_len, labelMode, loadGraph]);

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
        <label className="inline">
          Labels
          <select value={labelMode} onChange={(e) => setLabelMode(e.target.value as LabelMode)}>
            <option value="smart">Smart</option>
            <option value="full">Full</option>
            <option value="kind">Kind only</option>
            <option value="hidden">Hidden</option>
          </select>
        </label>
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
      <div className="graph-canvas-wrap">
        <div ref={containerRef} className="cy" />
        {tooltip && (
          <div className="graph-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
            <span className="graph-tooltip-kind">{tooltip.kind}</span>
            <span className="graph-tooltip-label">{tooltip.label}</span>
          </div>
        )}
      </div>
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
