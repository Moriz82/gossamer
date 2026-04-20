import cytoscape, { type Core } from "cytoscape";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, apiJson } from "../api";
import "../styles/graph.css";

// ------------------------------------------------------------------ Types

export type UIPrefs = {
  graph_layout: string;
  node_size: number;
  font_size: number;
  edge_opacity: number;
  edge_width: number;
  label_max_len: number;
  wheel_sensitivity: number;
};

type GraphNode = {
  id: string;
  kind: string;
  label?: string;
  color?: string;
  properties: Record<string, unknown>;
};

type GraphEdge = {
  id: string;
  kind: string;
  source: string;
  target: string;
  color?: string;
  properties?: Record<string, unknown>;
  sources?: string[];
};

type Finding = {
  id?: string | number;
  template_id?: string;
  name?: string;
  severity?: string;
  endpoint_id?: string;
  host_id?: string;
  node_id?: string;
  matched_at?: string;
  [k: string]: unknown;
};

type SelectedItem =
  | { kind: "node"; node: GraphNode }
  | { kind: "edge"; edge: GraphEdge }
  | null;

type Props = {
  ui: UIPrefs;
  onUiChange: (partial: Partial<UIPrefs>) => void;
  onPersistUi: () => void;
  backendType?: string;
};

// ------------------------------------------------------------------ Constants

const NODE_KINDS = ["Host", "Endpoint", "Source", "Finding", "Form"] as const;

const KIND_LETTER: Record<string, string> = {
  Host: "H",
  Endpoint: "E",
  Source: "S",
  Form: "F",
  Finding: "!",
};

const KIND_COLOR_VAR: Record<string, string> = {
  Host: "var(--kind-host)",
  Endpoint: "var(--kind-endpoint)",
  Source: "var(--kind-source)",
  Form: "var(--kind-form)",
  Finding: "var(--kind-finding)",
};

const EDGE_LEGEND: { kind: string; color: string; dash: boolean }[] = [
  { kind: "serves", color: "oklch(52% 0.04 220)", dash: false },
  { kind: "discovered_by", color: "oklch(48% 0.06 300)", dash: true },
  { kind: "links_to", color: "oklch(48% 0.03 220)", dash: true },
  { kind: "found_on", color: "oklch(60% 0.14 25)", dash: false },
];

const LAYOUTS = ["cose", "breadth", "circle", "grid"] as const;
type LayoutChip = (typeof LAYOUTS)[number];

const LAYOUT_TO_CY: Record<string, string> = {
  cose: "cose",
  breadth: "breadthfirst",
  circle: "circle",
  grid: "grid",
};

const REVERSE_EDGE_DISPLAY = new Set(["discovered_by"]);

const DEFAULT_NODE_COLOR = "#888";

// ------------------------------------------------------------------ Inline icons

type IconProps = { size?: number; style?: React.CSSProperties };
const ic = (d: React.ReactNode, size = 14, style?: React.CSSProperties) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    width={size}
    height={size}
    style={style}
  >
    {d}
  </svg>
);
const Icon = {
  search: ({ size, style }: IconProps) =>
    ic(
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4.3-4.3" />
      </>,
      size,
      style,
    ),
  plus: ({ size, style }: IconProps) =>
    ic(<path d="M12 5v14M5 12h14" />, size, style),
  close: ({ size, style }: IconProps) =>
    ic(<path d="M6 6l12 12M18 6L6 18" />, size, style),
  chevronR: ({ size, style }: IconProps) =>
    ic(<path d="m9 6 6 6-6 6" />, size, style),
  zoomIn: ({ size, style }: IconProps) =>
    ic(
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4.3-4.3M11 8v6M8 11h6" />
      </>,
      size,
      style,
    ),
  zoomOut: ({ size, style }: IconProps) =>
    ic(
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4.3-4.3M8 11h6" />
      </>,
      size,
      style,
    ),
  fit: ({ size, style }: IconProps) =>
    ic(
      <path d="M3 8V3h5M21 8V3h-5M3 16v5h5M21 16v5h-5" />,
      size,
      style,
    ),
  center: ({ size, style }: IconProps) =>
    ic(
      <>
        <circle cx="12" cy="12" r="2" />
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
      </>,
      size,
      style,
    ),
  target: ({ size, style }: IconProps) =>
    ic(
      <>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      </>,
      size,
      style,
    ),
  path: ({ size, style }: IconProps) =>
    ic(
      <>
        <circle cx="5" cy="19" r="2" />
        <circle cx="19" cy="5" r="2" />
        <path d="M6.4 17.6 17.6 6.4" strokeDasharray="2 3" />
      </>,
      size,
      style,
    ),
  note: ({ size, style }: IconProps) =>
    ic(
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5" />,
      size,
      style,
    ),
  filter: ({ size, style }: IconProps) =>
    ic(<path d="M3 4h18l-7 10v5l-4 2v-7z" />, size, style),
  save: ({ size, style }: IconProps) =>
    ic(
      <>
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
        <path d="M17 21v-8H7v8M7 3v5h8" />
      </>,
      size,
      style,
    ),
  export: ({ size, style }: IconProps) =>
    ic(
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5-5 5 5M12 5v12" />,
      size,
      style,
    ),
  link: ({ size, style }: IconProps) =>
    ic(
      <>
        <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
        <path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
      </>,
      size,
      style,
    ),
};

// ------------------------------------------------------------------ Primitives

function Severity({ s }: { s: string }) {
  const cls = (s || "").toLowerCase().slice(0, 4);
  const short =
    cls.startsWith("crit") ? "crit" :
    cls.startsWith("high") ? "high" :
    cls.startsWith("med")  ? "med"  :
    cls.startsWith("low")  ? "low"  : "info";
  return <span className={`sev-chip ${short}`}>{short}</span>;
}

function Status({ code }: { code: number }) {
  const cls = `s-${Math.floor(code / 100)}xx`;
  return <span className={`status-chip ${cls}`}>{code}</span>;
}

// ------------------------------------------------------------------ Helpers

function smartLabel(
  kind: string,
  props: Record<string, unknown>,
  maxLen: number,
): string {
  const url = String(props.url || props.action_url || "");
  const hostname = String(props.hostname || "");
  const name = String(props.name || "");
  switch (kind) {
    case "Endpoint": {
      if (!url) return kind;
      try {
        const u = new URL(url);
        const path = u.pathname + (u.search ? u.search.slice(0, 20) : "");
        return path.length > maxLen ? path.slice(0, maxLen) + "…" : path;
      } catch {
        return url.slice(0, maxLen);
      }
    }
    case "Host":
      return hostname || kind;
    case "Finding":
      return name ? (name.length > 25 ? name.slice(0, 25) + "…" : name) : "Finding";
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

function nodeDisplayLabel(n: GraphNode, maxLen = 40): string {
  if (n.label) return n.label;
  return smartLabel(n.kind, n.properties, maxLen);
}

function nodeIconSvg(letter: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><text x="12" y="17" text-anchor="middle" font-size="15" font-weight="700" font-family="sans-serif" fill="rgba(0,0,0,0.75)">${letter}</text></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

const NODE_ICON_SVGS: Record<string, string> = Object.fromEntries(
  Object.entries(KIND_LETTER).map(([k, l]) => [k, nodeIconSvg(l)]),
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function layoutOpts(name: string): any {
  const cyName = LAYOUT_TO_CY[name] || name;
  const base = { name: cyName, animate: false };
  if (cyName === "cose") {
    return {
      ...base,
      nodeRepulsion: () => 8000,
      idealEdgeLength: () => 80,
      edgeElasticity: () => 100,
      gravity: 0.25,
      numIter: 1000,
      nodeDimensionsIncludeLabels: true,
    };
  }
  if (cyName === "breadthfirst") {
    return { ...base, spacingFactor: 1.5 };
  }
  return base;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeStylesheet(ui: UIPrefs): any[] {
  return [
    {
      selector: "node",
      style: {
        label: "data(label)",
        "font-size": ui.font_size,
        "min-zoomed-font-size": 10,
        color: "#d7dde8",
        "text-outline-width": 2,
        "text-outline-color": "#0b0e14",
        width: "data(size)",
        height: "data(size)",
        "background-color": "data(bg)",
        "text-halign": "center",
        "text-valign": "bottom",
        "text-margin-y": 6,
        "text-wrap": "ellipsis",
        "text-max-width": "120px",
        "background-image": "data(iconSvg)",
        "background-width": "60%",
        "background-height": "60%",
        "background-clip": "none",
      },
    },
    {
      selector: "edge",
      style: {
        width: ui.edge_width,
        "line-color": "data(ec)",
        "target-arrow-color": "data(ec)",
        "target-arrow-shape": "triangle",
        "arrow-scale": 0.8,
        "curve-style": "bezier",
        opacity: ui.edge_opacity,
        label: "data(kind)",
        "font-size": 8,
        "text-rotation": "autorotate",
        "text-opacity": 0.5,
        color: "#8795a8",
      },
    },
    { selector: ".dimmed", style: { opacity: 0.12 } },
    {
      selector: ".highlighted",
      style: {
        "border-width": 3,
        "border-color": "#c7d8ef",
        "border-opacity": 1,
      },
    },
    {
      selector: ":selected",
      style: {
        "border-width": 3,
        "border-color": "#b8d4e8",
        "border-opacity": 1,
      },
    },
  ];
}

function findingNodeMatches(f: Finding, node: GraphNode): boolean {
  const nid = String(node.id);
  const fEp = f.endpoint_id != null ? String(f.endpoint_id) : "";
  const fHost = f.host_id != null ? String(f.host_id) : "";
  const fNode = f.node_id != null ? String(f.node_id) : "";
  if (fEp && fEp === nid) return true;
  if (fHost && fHost === nid) return true;
  if (fNode && fNode === nid) return true;
  // fallback: match by URL
  const nUrl = String(node.properties.url || "");
  const fUrl = String((f as Record<string, unknown>).url || "");
  if (nUrl && fUrl && nUrl === fUrl) return true;
  return false;
}

// ------------------------------------------------------------------ Component

export default function GraphPanel({
  ui,
  onUiChange,
  onPersistUi,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const uiRef = useRef(ui);
  uiRef.current = ui;

  // ------------- state
  const [status, setStatus] = useState<string>("");
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [selected, setSelected] = useState<SelectedItem>(null);
  const [zoomPct, setZoomPct] = useState(100);
  const [search, setSearch] = useState("");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [kindFilter, setKindFilter] = useState<Record<string, boolean>>(
    () => Object.fromEntries(NODE_KINDS.map((k) => [k, true])) as Record<string, boolean>,
  );
  const [sourceFilter, setSourceFilter] = useState<Record<string, boolean>>({});
  const [inspTab, setInspTab] = useState<"overview" | "properties" | "neighbors" | "findings">(
    "overview",
  );
  const [findings, setFindings] = useState<Finding[]>([]);
  const [findingsLoading, setFindingsLoading] = useState(false);

  // ------------- derived
  const layoutChip: LayoutChip = useMemo(() => {
    const k = ui.graph_layout;
    if (k === "cose" || k === "circle" || k === "grid") return k as LayoutChip;
    if (k === "breadthfirst") return "breadth";
    return "cose";
  }, [ui.graph_layout]);

  const nodeById = useMemo(() => {
    const m: Record<string, GraphNode> = {};
    for (const n of nodes) m[n.id] = n;
    return m;
  }, [nodes]);

  const visibleNodes = useMemo(
    () => nodes.filter((n) => kindFilter[n.kind] !== false),
    [nodes, kindFilter],
  );
  const visibleEdges = useMemo(() => {
    const set = new Set(visibleNodes.map((n) => n.id));
    return edges.filter((e) => set.has(e.source) && set.has(e.target));
  }, [edges, visibleNodes]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const n of nodes) c[n.kind] = (c[n.kind] || 0) + 1;
    return c;
  }, [nodes]);

  const sources = useMemo(() => {
    const s = new Set<string>();
    for (const n of nodes) {
      if (n.kind === "Source") {
        const name = String(n.properties?.name || "").trim();
        if (name) s.add(name);
      }
    }
    return Array.from(s).sort();
  }, [nodes]);

  // Ensure new sources default to "on" in the filter
  useEffect(() => {
    if (sources.length === 0) return;
    setSourceFilter((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const s of sources) if (!(s in next)) { next[s] = true; changed = true; }
      return changed ? next : prev;
    });
  }, [sources]);

  // neighbors of selected node
  const neighbors = useMemo(() => {
    if (!selected || selected.kind !== "node") return [];
    const id = selected.node.id;
    const out: { edge: GraphEdge; node: GraphNode; dir: "in" | "out" }[] = [];
    for (const e of edges) {
      if (e.source === id && nodeById[e.target]) {
        out.push({ edge: e, node: nodeById[e.target], dir: "out" });
      } else if (e.target === id && nodeById[e.source]) {
        out.push({ edge: e, node: nodeById[e.source], dir: "in" });
      }
    }
    return out;
  }, [selected, edges, nodeById]);

  const nodeFindings = useMemo(() => {
    if (!selected || selected.kind !== "node") return [];
    return findings.filter((f) => findingNodeMatches(f, selected.node));
  }, [selected, findings]);

  // ------------- cytoscape sync

  // Container ResizeObserver — cytoscape needs an explicit resize() when the
  // parent element's size changes (e.g., sidebar collapse), otherwise rendered
  // positions / hit testing drift. First mount can also run before the grid
  // column settles, so the first fit() happens here once we actually have width.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let hasFit = false;
    const ro = new ResizeObserver(() => {
      const cy = cyRef.current;
      if (!cy) return;
      cy.resize();
      if (!hasFit && cy.elements().length > 0 && el.clientWidth > 0) {
        cy.fit(undefined, 24);
        hasFit = true;
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const applyCyData = useCallback(
    (cy: Core, ns: GraphNode[], es: GraphEdge[], cur: UIPrefs, doLayout: boolean) => {
      const cyNodes = ns.map((n) => ({
        data: {
          id: n.id,
          label: nodeDisplayLabel(n, cur.label_max_len),
          bg: n.color || DEFAULT_NODE_COLOR,
          kind: n.kind,
          props: n.properties,
          size:
            n.kind === "Host"
              ? cur.node_size * 1.4
              : n.kind === "Source"
                ? cur.node_size * 0.7
                : cur.node_size,
          iconSvg: NODE_ICON_SVGS[n.kind] || NODE_ICON_SVGS.Source,
        },
      }));
      const cyEdges = es.map((e) => {
        const rev = REVERSE_EDGE_DISPLAY.has(e.kind);
        return {
          data: {
            id: e.id,
            source: rev ? e.target : e.source,
            target: rev ? e.source : e.target,
            ec: e.color || "#6c7a90",
            kind: e.kind,
          },
        };
      });
      cy.elements().remove();
      cy.add([...cyNodes, ...cyEdges]);
      if (doLayout) {
        cy.resize();
        cy.layout(layoutOpts(cur.graph_layout) as cytoscape.LayoutOptions).run();
        cy.fit(undefined, 24);
      }
    },
    [],
  );

  const loadGraph = useCallback(async () => {
    const cur = uiRef.current;
    try {
      const r = await apiFetch(`/api/graph`);
      if (!r.ok) {
        setStatus("Failed to load graph");
        return;
      }
      const data = (await r.json()) as { nodes: GraphNode[]; edges: GraphEdge[] };
      setNodes(data.nodes);
      setEdges(data.edges);
      setStatus(`${data.nodes.length} nodes, ${data.edges.length} edges`);
      const cy = cyRef.current;
      if (cy) applyCyData(cy, data.nodes, data.edges, cur, true);
    } catch (e) {
      setStatus(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [applyCyData]);

  // ------------- init cytoscape
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let cy: Core;
    try {
      cy = cytoscape({
        container: el,
        elements: [],
        style: makeStylesheet(uiRef.current),
        layout: layoutOpts(uiRef.current.graph_layout),
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
      const d = evt.target.data();
      setSelected({
        kind: "node",
        node: {
          id: String(d.id),
          kind: String(d.kind),
          label: String(d.label),
          color: String(d.bg || DEFAULT_NODE_COLOR),
          properties: (d.props || {}) as Record<string, unknown>,
        },
      });
    });
    cy.on("tap", "edge", (evt) => {
      const d = evt.target.data();
      setSelected({
        kind: "edge",
        edge: {
          id: String(d.id),
          kind: String(d.kind),
          source: String(d.source),
          target: String(d.target),
          color: String(d.ec),
        },
      });
    });
    cy.on("tap", (evt) => {
      if (evt.target === cy) setSelected(null);
    });
    cy.on("zoom", () => setZoomPct(Math.round(cy.zoom() * 100)));

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, []);

  // load initial graph once
  useEffect(() => {
    void loadGraph();
    // fetch findings too (used in inspector tab + finding kind)
    apiJson<{ findings: Finding[] }>("/api/findings?limit=2000")
      .then((r) => setFindings(r.findings || []))
      .catch(() => setFindings([]));
  }, [loadGraph]);

  // restyle on ui prefs change
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    try {
      cy.style().fromJson(makeStylesheet(uiRef.current) as unknown as cytoscape.StylesheetJson).update();
    } catch {
      /* ignore */
    }
  }, [ui.node_size, ui.font_size, ui.edge_opacity, ui.edge_width]);

  // re-layout on layout change
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || cy.elements().length === 0) return;
    cy.layout(layoutOpts(ui.graph_layout) as cytoscape.LayoutOptions).run();
    cy.fit(undefined, 24);
  }, [ui.graph_layout]);

  // kind-filter sync — hide/show elements
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.nodes().forEach((node) => {
        const k = String(node.data("kind"));
        const vis = kindFilter[k] !== false;
        node.style("display", vis ? "element" : "none");
      });
      cy.edges().forEach((edge) => {
        const s = cy.getElementById(String(edge.data("source")));
        const t = cy.getElementById(String(edge.data("target")));
        const sVis = s.length ? s.style("display") !== "none" : false;
        const tVis = t.length ? t.style("display") !== "none" : false;
        edge.style("display", sVis && tVis ? "element" : "none");
      });
    });
  }, [kindFilter, nodes, edges]);

  // search highlighting
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    if (!search.trim()) {
      cy.elements().removeClass("dimmed highlighted");
      return;
    }
    const q = search.toLowerCase();
    cy.batch(() => {
      cy.nodes().forEach((node) => {
        const d = node.data();
        const label = String(d.label || "").toLowerCase();
        const kind = String(d.kind || "").toLowerCase();
        const id = String(d.id || "").toLowerCase();
        if (label.includes(q) || kind.includes(q) || id.includes(q)) {
          node.addClass("highlighted");
          node.removeClass("dimmed");
        } else {
          node.addClass("dimmed");
          node.removeClass("highlighted");
        }
      });
    });
  }, [search]);

  // when selection changes and findings tab is active, refresh findings lazily
  useEffect(() => {
    if (inspTab !== "findings") return;
    if (!selected || selected.kind !== "node") return;
    if (findings.length > 0) return;
    setFindingsLoading(true);
    apiJson<{ findings: Finding[] }>("/api/findings?limit=2000")
      .then((r) => setFindings(r.findings || []))
      .catch(() => setFindings([]))
      .finally(() => setFindingsLoading(false));
  }, [inspTab, selected, findings.length]);

  // ------------- toolbar actions

  const zoomIn = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.zoom({ level: Math.min(4, cy.zoom() * 1.2), renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  }, []);
  const zoomOut = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.zoom({ level: Math.max(0.1, cy.zoom() / 1.2), renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  }, []);
  const fit = useCallback(() => {
    cyRef.current?.fit(undefined, 24);
  }, []);
  const center = useCallback(() => {
    cyRef.current?.center();
  }, []);

  const exportJson = useCallback(() => {
    const payload = { nodes, edges };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "graph.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [nodes, edges]);

  const setLayoutChip = useCallback(
    (chip: LayoutChip) => {
      const real = LAYOUT_TO_CY[chip];
      onUiChange({ graph_layout: real });
      onPersistUi();
    },
    [onUiChange, onPersistUi],
  );

  const toggleKind = useCallback((k: string) => {
    setKindFilter((prev) => ({ ...prev, [k]: !prev[k] }));
  }, []);
  const toggleSource = useCallback((s: string) => {
    setSourceFilter((prev) => ({ ...prev, [s]: !prev[s] }));
  }, []);

  // ------------- render helpers

  const selectedNode = selected && selected.kind === "node" ? selected.node : null;

  // ------------- UI

  return (
    <div
      className={`graph-screen ${!leftOpen ? "left-collapsed" : ""} ${!rightOpen ? "right-collapsed" : ""}`}
    >
      {!leftOpen && (
        <button
          type="button"
          className="panel-handle left"
          onClick={() => setLeftOpen(true)}
          title="Show filters"
        >
          <Icon.chevronR size={14} />
        </button>
      )}

      {leftOpen && (
        <aside className="graph-sidebar">
          <div className="gs-section">
            <div className="searchbar">
              <Icon.search size={13} />
              <input
                placeholder="Search nodes…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <kbd>/</kbd>
            </div>
          </div>

          <div className="gs-section">
            <div className="gs-title">
              <span>Node kinds</span>
              <span className="mono" style={{ color: "var(--fg-3)" }}>
                {visibleNodes.length}/{nodes.length}
              </span>
            </div>
            {NODE_KINDS.map((k) => (
              <div
                key={k}
                className={`kind-row ${!kindFilter[k] ? "off" : ""}`}
                onClick={() => toggleKind(k)}
              >
                <span
                  className="kind-swatch"
                  style={{ background: KIND_COLOR_VAR[k], color: KIND_COLOR_VAR[k] }}
                />
                <span className="kind-name">{k}</span>
                <span className="kind-count">{counts[k] || 0}</span>
              </div>
            ))}
          </div>

          <div className="gs-section">
            <div className="gs-title">Discovered by</div>
            <div className="chip-row">
              {sources.length === 0 && (
                <span className="mono" style={{ color: "var(--fg-3)", fontSize: "var(--fs-xs)" }}>
                  —
                </span>
              )}
              {sources.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`chip ${sourceFilter[s] ? "on" : ""}`}
                  onClick={() => toggleSource(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="gs-section">
            <div className="gs-title">
              <span>Saved views</span>
              <button type="button" className="chip" style={{ padding: "2px 6px" }} title="Add view">
                <Icon.plus size={11} />
              </button>
            </div>
            <div className="saved-views">
              {[
                { n: "Exposed credentials", c: 0 },
                { n: "Unauthenticated admin", c: 0 },
                { n: "High-severity attack paths", c: 0 },
                { n: "Staging surface", c: 0 },
              ].map((v) => (
                <div key={v.n} className="saved-view">
                  <span>{v.n}</span>
                  <span className="sv-count">{v.c}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="gs-section" style={{ marginTop: "auto", borderBottom: 0 }}>
            <div className="gs-title">Layout</div>
            <div className="chip-row">
              {LAYOUTS.map((l) => (
                <button
                  type="button"
                  key={l}
                  className={`chip ${layoutChip === l ? "on" : ""}`}
                  onClick={() => setLayoutChip(l)}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            className="panel-collapse left"
            onClick={() => setLeftOpen(false)}
            title="Collapse"
          >
            <Icon.chevronR size={14} style={{ transform: "rotate(180deg)" }} />
          </button>
        </aside>
      )}

      {/* CANVAS */}
      <div className="graph-canvas-wrap">
        <div className="canvas-grid" />
        <div ref={containerRef} className="cy-viewport" />

        {visibleNodes.length === 0 && (
          <div className="graph-empty-overlay">
            <span>{status || "No graph data yet — run a scan or ingest to populate."}</span>
          </div>
        )}

        <div className="graph-toolbar">
          <div className="gt-group">
            <button type="button" className="gt-btn on">
              <Icon.target size={12} /> Pointer
            </button>
            <button type="button" className="gt-btn" title="Pathfinding (not wired)">
              <Icon.path size={12} /> Path
            </button>
            <button type="button" className="gt-btn" title="Add note (not wired)">
              <Icon.note size={12} /> Note
            </button>
          </div>
          <div className="gt-group">
            <button
              type="button"
              className="gt-btn"
              onClick={() => setLeftOpen((o) => !o)}
              title="Toggle filters"
            >
              <Icon.filter size={12} /> Filters
            </button>
            <button
              type="button"
              className="gt-btn"
              onClick={onPersistUi}
              title="Persist UI prefs"
            >
              <Icon.save size={12} /> Save view
            </button>
            <button type="button" className="gt-btn" onClick={exportJson} title="Export JSON">
              <Icon.export size={12} /> Export
            </button>
          </div>
        </div>

        <div className="graph-badges">
          <div className="graph-badge">
            <strong>{visibleNodes.length}</strong> nodes
          </div>
          <div className="graph-badge">
            <strong>{visibleEdges.length}</strong> edges
          </div>
          <div className="graph-badge mono">{zoomPct}%</div>
        </div>

        <div className="zoom-controls">
          <button type="button" onClick={zoomIn} title="Zoom in">
            <Icon.zoomIn size={14} />
          </button>
          <button type="button" onClick={zoomOut} title="Zoom out">
            <Icon.zoomOut size={14} />
          </button>
          <button type="button" onClick={fit} title="Fit">
            <Icon.fit size={14} />
          </button>
          <button type="button" onClick={center} title="Center">
            <Icon.center size={14} />
          </button>
        </div>

        <div className="legend">
          <div className="legend-title">Edges</div>
          {EDGE_LEGEND.map((e) => (
            <div key={e.kind} className="legend-item">
              <svg width="24" height="8">
                <line
                  x1="0"
                  y1="4"
                  x2="24"
                  y2="4"
                  stroke={e.color}
                  strokeWidth="1.5"
                  strokeDasharray={e.dash ? "3 3" : "none"}
                />
              </svg>
              <span className="mono" style={{ fontSize: 10 }}>
                {e.kind}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* RIGHT COLLAPSE HANDLE */}
      {!rightOpen && (
        <button
          type="button"
          className="panel-handle right"
          onClick={() => setRightOpen(true)}
          title="Show inspector"
        >
          <Icon.chevronR size={14} style={{ transform: "rotate(180deg)" }} />
        </button>
      )}

      {/* INSPECTOR */}
      {rightOpen && (selectedNode ? (
        <aside className="inspector">
          <button
            type="button"
            className="panel-collapse right"
            onClick={() => setRightOpen(false)}
            title="Collapse"
          >
            <Icon.chevronR size={14} />
          </button>
          <div className="insp-header">
            <div
              className="insp-glyph"
              style={{
                background:
                  selectedNode.kind === "Finding"
                    ? "oklch(25% 0.08 25)"
                    : `color-mix(in oklch, ${KIND_COLOR_VAR[selectedNode.kind] || "var(--silk)"} 18%, transparent)`,
                color:
                  selectedNode.kind === "Finding"
                    ? "var(--sev-high)"
                    : KIND_COLOR_VAR[selectedNode.kind] || "var(--silk)",
              }}
            >
              {KIND_LETTER[selectedNode.kind] || selectedNode.kind.charAt(0)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="insp-kind">
                <span>{selectedNode.kind}</span>
                {selectedNode.kind === "Finding" && Boolean(selectedNode.properties.severity) && (
                  <Severity s={String(selectedNode.properties.severity)} />
                )}
              </div>
              <div className="insp-title">{nodeDisplayLabel(selectedNode, 80)}</div>
            </div>
            <button
              type="button"
              className="chip"
              style={{ padding: "3px 6px" }}
              onClick={() => setSelected(null)}
              title="Close"
            >
              <Icon.close size={13} />
            </button>
          </div>

          <div className="insp-tabs">
            {(["overview", "properties", "neighbors", "findings"] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={`insp-tab ${inspTab === t ? "on" : ""}`}
                onClick={() => setInspTab(t)}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="insp-body">
            {inspTab === "overview" && (
              <OverviewTab node={selectedNode} />
            )}

            {inspTab === "properties" && (
              <PropertiesTab node={selectedNode} />
            )}

            {inspTab === "neighbors" && (
              <>
                <div
                  style={{
                    fontSize: "var(--fs-xs)",
                    color: "var(--fg-3)",
                    marginBottom: 8,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                  }}
                >
                  {neighbors.length} connections
                </div>
                {neighbors.map(({ edge, node, dir }, i) => (
                  <div
                    key={`${edge.id}-${i}`}
                    className="neighbor"
                    onClick={() => {
                      setSelected({ kind: "node", node });
                      const cy = cyRef.current;
                      if (cy) {
                        const el = cy.getElementById(node.id);
                        if (el.length) {
                          cy.animate({ center: { eles: el }, zoom: Math.max(cy.zoom(), 1.5) }, { duration: 250 });
                          el.select();
                        }
                      }
                    }}
                  >
                    <span className="nb-edge">
                      {dir === "out" ? "→" : "←"} {edge.kind}
                    </span>
                    <span
                      className="nb-swatch"
                      style={{ background: KIND_COLOR_VAR[node.kind] || "var(--silk)" }}
                    />
                    <span className="nb-label">{nodeDisplayLabel(node, 60)}</span>
                  </div>
                ))}
                {neighbors.length === 0 && (
                  <div style={{ color: "var(--fg-3)", fontSize: "var(--fs-sm)" }}>
                    No neighbors in the current graph.
                  </div>
                )}
              </>
            )}

            {inspTab === "findings" && (
              <FindingsTab
                findings={nodeFindings}
                loading={findingsLoading}
              />
            )}
          </div>
        </aside>
      ) : (
        <aside className="inspector">
          <button
            type="button"
            className="panel-collapse right"
            onClick={() => setRightOpen(false)}
            title="Collapse"
          >
            <Icon.chevronR size={14} />
          </button>
          <div className="insp-body" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, textAlign: "center", color: "var(--fg-3)" }}>
            <Icon.target size={48} />
            <div style={{ color: "var(--fg-1)", fontSize: "var(--fs-md)" }}>Nothing selected</div>
            <div style={{ fontSize: "var(--fs-sm)" }}>
              Click a node in the graph to inspect it.
            </div>
          </div>
        </aside>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Tabs

function OverviewTab({ node }: { node: GraphNode }) {
  const p = node.properties || {};
  const url = String(p.url || p.action_url || "");
  const hostname = String(p.hostname || "");
  const status = p.status_code != null ? Number(p.status_code) : null;
  const first = (p.first_seen || p.created_at || "") as string;
  const last = (p.last_seen || p.updated_at || "") as string;
  const srcs = Array.isArray(p.sources) ? (p.sources as unknown[]).map(String).join(" · ") : "";
  const size = p.content_length != null ? Number(p.content_length) : null;
  const tech = (p.server_version || p.server || p.technologies || "") as string;

  const rows: [string, React.ReactNode][] = [
    ["ID", <span key="id">{node.id}</span>],
    ["Kind", <span key="kind">{node.kind}</span>],
  ];
  if (status != null) rows.push(["Status", <Status key="status" code={status} />]);
  if (url) rows.push(["URL", <span key="url">{url}</span>]);
  if (hostname) rows.push(["Host", <span key="host">{hostname}</span>]);
  if (first) rows.push(["First seen", <span key="first">{String(first)}</span>]);
  if (last) rows.push(["Last seen", <span key="last">{String(last)}</span>]);
  if (srcs) rows.push(["Sources", <span key="srcs">{srcs}</span>]);
  if (size != null) rows.push(["Size", <span key="size" className="num">{size.toLocaleString()} B</span>]);
  if (tech) rows.push(["Tech", <span key="tech">{String(tech)}</span>]);

  return (
    <>
      {rows.map(([k, v]) => (
        <div key={k} className="prop-row">
          <div className="prop-key">{k}</div>
          <div className="prop-val">{v}</div>
        </div>
      ))}
      <div className="insp-actions">
        <button
          type="button"
          className="insp-btn primary"
          onClick={() => {
            // find paths not wired yet — placeholder
          }}
        >
          <Icon.path size={11} style={{ marginRight: 4 }} /> Find paths
        </button>
        {url && (
          <a className="insp-btn" href={url} target="_blank" rel="noreferrer">
            <Icon.link size={11} style={{ marginRight: 4 }} /> Open URL
          </a>
        )}
        <button type="button" className="insp-btn">
          <Icon.note size={11} style={{ marginRight: 4 }} /> Add note
        </button>
        <button
          type="button"
          className="insp-btn"
          onClick={() => {
            const blob = new Blob([JSON.stringify(node, null, 2)], { type: "application/json" });
            const u = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = u;
            a.download = `node-${node.id}.json`;
            a.click();
            URL.revokeObjectURL(u);
          }}
        >
          <Icon.export size={11} style={{ marginRight: 4 }} /> Export JSON
        </button>
      </div>
    </>
  );
}

function PropertiesTab({ node }: { node: GraphNode }) {
  const entries = Object.entries(node.properties || {});
  if (entries.length === 0) {
    return (
      <div style={{ color: "var(--fg-3)", fontSize: "var(--fs-sm)" }}>No properties.</div>
    );
  }
  return (
    <>
      {entries.map(([k, v]) => {
        const s = typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
        const isNum = typeof v === "number";
        return (
          <div key={k} className="prop-row">
            <div className="prop-key">{k}</div>
            <div className={`prop-val${isNum ? " num" : ""}`}>{s}</div>
          </div>
        );
      })}
    </>
  );
}

function FindingsTab({ findings, loading }: { findings: Finding[]; loading: boolean }) {
  if (loading) {
    return (
      <div style={{ color: "var(--fg-3)", fontSize: "var(--fs-sm)" }}>Loading…</div>
    );
  }
  if (findings.length === 0) {
    return (
      <div style={{ color: "var(--fg-3)", fontSize: "var(--fs-sm)" }}>
        No findings directly attached to this node.
      </div>
    );
  }
  return (
    <>
      {findings.map((f, i) => (
        <div
          key={String(f.id ?? i)}
          style={{
            marginBottom: 10,
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            padding: 10,
            background: "oklch(20% 0.04 250)",
            borderRadius: "var(--r-md)",
            border: "1px solid var(--line-0)",
          }}
        >
          {f.severity && <Severity s={String(f.severity)} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: "var(--fg-0)", fontWeight: 500, marginBottom: 4 }}>
              {String(f.name || f.template_id || "Finding")}
            </div>
            {f.template_id && (
              <div
                style={{
                  fontFamily: "var(--ff-mono)",
                  fontSize: 11,
                  color: "var(--fg-2)",
                  wordBreak: "break-all",
                }}
              >
                {String(f.template_id)}
              </div>
            )}
          </div>
        </div>
      ))}
    </>
  );
}
