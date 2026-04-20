import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiJson } from "../api";

type EndpointNode = {
  id: string;
  kind: string;
  properties: {
    url?: string;
    method?: string;
    status_code?: number;
    content_type?: string;
    response_id?: string;
    title?: string;
    tech?: string;
    source?: string;
    findings?: number;
    [key: string]: unknown;
  };
};

type GraphData = {
  nodes: EndpointNode[];
  edges: { source: string; target: string; kind: string }[];
};

type ResponseData = {
  id: string;
  url: string;
  method: string;
  status: number | null;
  timestamp: string;
  request_headers: Record<string, string>;
  response_headers: Record<string, string>;
  body: string | null;
  body_size: number;
};

type EndpointRow = {
  id: string;
  host: string;
  path: string;
  method: string;
  status: number | null;
  url: string;
  tech: string;
  source: string;
  findings: number;
  responseId?: string;
  raw: EndpointNode;
};

type MethodKey = "GET" | "POST" | "PUT" | "DELETE" | "HEAD";
type StatusFilter = "all" | "2" | "3" | "4" | "5";

const METHODS: MethodKey[] = ["GET", "POST", "PUT", "DELETE", "HEAD"];
const STATUSES: StatusFilter[] = ["all", "2", "3", "4", "5"];

/* ---------- minimal inline icons (match new UI style) ---------- */
function IconSearch({ size = 14 }: { size?: number }) {
  return (
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
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4.3-4.3" />
    </svg>
  );
}
function IconChevronR({ size = 10 }: { size?: number }) {
  return (
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
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
function IconExport({ size = 12 }: { size?: number }) {
  return (
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
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5-5 5 5M12 5v12" />
    </svg>
  );
}

function Method({ m }: { m: string }) {
  const lc = (m || "GET").toLowerCase();
  return <span className={`method ${lc}`}>{(m || "GET").toUpperCase()}</span>;
}

function Status({ code }: { code: number | null | undefined }) {
  if (!code) return <span className="status-chip s-none">—</span>;
  const cls = "s-" + Math.floor(code / 100) + "xx";
  return <span className={`status-chip ${cls}`}>{code}</span>;
}

/* ---------- data helpers ---------- */
function toRow(ep: EndpointNode): EndpointRow | null {
  const url = ep.properties.url;
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const method = (ep.properties.method || "GET").toUpperCase();
  const status =
    typeof ep.properties.status_code === "number" ? ep.properties.status_code : null;
  return {
    id: ep.id,
    host: parsed.hostname,
    path: parsed.pathname + (parsed.search || ""),
    method,
    status,
    url,
    tech: typeof ep.properties.tech === "string" ? ep.properties.tech : "",
    source: typeof ep.properties.source === "string" ? ep.properties.source : "",
    findings:
      typeof ep.properties.findings === "number" ? ep.properties.findings : 0,
    responseId:
      typeof ep.properties.response_id === "string"
        ? ep.properties.response_id
        : undefined,
    raw: ep,
  };
}

function buildCurl(row: EndpointRow, headers?: Record<string, string>): string {
  const parts: string[] = [`curl -X ${row.method}`];
  if (headers) {
    for (const [k, v] of Object.entries(headers)) {
      if (!v) continue;
      parts.push(`-H ${JSON.stringify(`${k}: ${v}`)}`);
    }
  }
  parts.push(JSON.stringify(row.url));
  return parts.join(" ");
}

/* ---------- component ---------- */
export default function SitemapPanel() {
  const [rows, setRows] = useState<EndpointRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<EndpointRow | null>(null);
  const [response, setResponse] = useState<ResponseData | null>(null);
  const [selectedHost, setSelectedHost] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [methodFilter, setMethodFilter] = useState<Record<MethodKey, boolean>>({
    GET: true,
    POST: true,
    PUT: true,
    DELETE: true,
    HEAD: true,
  });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    };
  }, []);

  useEffect(() => {
    setLoading(true);
    apiJson<GraphData>("/api/graph?kinds=Endpoint")
      .then((data) => {
        const mapped = data.nodes
          .filter((n) => n.kind === "Endpoint")
          .map(toRow)
          .filter((r): r is EndpointRow => r !== null);
        setRows(mapped);
      })
      .catch(() => {
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, []);

  // group endpoints by host
  const byHost = useMemo(() => {
    const m = new Map<string, EndpointRow[]>();
    for (const r of rows) {
      if (!m.has(r.host)) m.set(r.host, []);
      m.get(r.host)!.push(r);
    }
    return Array.from(m.entries()).map(([h, eps]) => ({ h, eps }));
  }, [rows]);

  // findings count per host
  const findingsByHost = useMemo(() => {
    const out: Record<string, number> = {};
    for (const { h, eps } of byHost) {
      out[h] = eps.reduce((s, e) => s + (e.findings || 0), 0);
    }
    return out;
  }, [byHost]);

  // auto-select first host when data loads
  useEffect(() => {
    if (!selectedHost && byHost.length > 0) {
      setSelectedHost(byHost[0].h);
    }
  }, [byHost, selectedHost]);

  // filtered table rows for the selected host
  const tableRows = useMemo(() => {
    if (!selectedHost) return [] as EndpointRow[];
    return rows
      .filter((r) => r.host === selectedHost)
      .filter((r) => methodFilter[r.method as MethodKey] !== false)
      .filter((r) => {
        if (statusFilter === "all") return true;
        if (r.status == null) return false;
        return String(r.status).startsWith(statusFilter);
      })
      .filter((r) => !query || r.path.toLowerCase().includes(query.toLowerCase()));
  }, [rows, selectedHost, methodFilter, statusFilter, query]);

  const handleSelectRow = useCallback(async (row: EndpointRow) => {
    setSelected(row);
    setResponse(null);
    if (!row.responseId) return;
    try {
      const data = await apiJson<ResponseData>(`/api/responses/${row.responseId}`);
      setResponse(data);
    } catch {
      /* response not stored */
    }
  }, []);

  const toggleMethod = useCallback((m: MethodKey) => {
    setMethodFilter((f) => ({ ...f, [m]: !f[m] }));
  }, []);

  const flashMessage = useCallback((msg: string) => {
    setFlash(msg);
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => {
      setFlash(null);
      flashTimer.current = null;
    }, 1800);
  }, []);

  const handleCopyUrl = useCallback(async () => {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected.url);
      flashMessage("URL copied");
    } catch {
      flashMessage("Copy failed");
    }
  }, [selected, flashMessage]);

  const handleCurl = useCallback(async () => {
    if (!selected) return;
    const curl = buildCurl(selected, response?.request_headers);
    try {
      await navigator.clipboard.writeText(curl);
      flashMessage("cURL copied");
    } catch {
      flashMessage("Copy failed");
    }
  }, [selected, response, flashMessage]);

  const handleOpenInGraph = useCallback(() => {
    if (!selected) return;
    try {
      sessionStorage.setItem("gossamer_graph_focus", selected.id);
    } catch {
      /* ignore */
    }
    flashMessage("Focus saved for Graph tab");
  }, [selected, flashMessage]);

  const handleRescan = useCallback(async () => {
    if (!selected) return;
    try {
      await apiJson(`/api/scans`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: selected.url }),
      });
      flashMessage("Re-scan queued");
    } catch {
      flashMessage("Re-scan endpoint unavailable");
    }
  }, [selected, flashMessage]);

  const handleExport = useCallback(() => {
    const payload = JSON.stringify(tableRows, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sitemap-${selectedHost || "all"}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, [tableRows, selectedHost]);

  if (loading) {
    return (
      <div className="sitemap">
        <div className="sitemap-tree">
          <div className="tree-scroll" style={{ padding: 16, color: "var(--fg-2)" }}>
            Loading sitemap…
          </div>
        </div>
        <section className="sitemap-main" />
      </div>
    );
  }

  const totalEps = rows.length;

  return (
    <div className="sitemap">
      {/* LEFT: host tree */}
      <aside className="sitemap-tree">
        <div className="tree-search">
          <div className="searchbar">
            <IconSearch size={12} />
            <input
              placeholder="Search sitemap…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="tree-scroll">
          {byHost.length === 0 ? (
            <div style={{ padding: 16, color: "var(--fg-2)", fontSize: 12 }}>
              No endpoints yet. Run a crawl to populate the sitemap.
            </div>
          ) : (
            byHost.map(({ h, eps }) => {
              const isCollapsed = collapsed[h] === true;
              const isActive = selectedHost === h;
              return (
                <div key={h} className={`tree-group ${isActive ? "active" : ""}`}>
                  <div
                    className="tree-host"
                    onClick={() => {
                      setSelectedHost(h);
                      setCollapsed((c) => ({ ...c, [h]: !c[h] }));
                    }}
                  >
                    <span
                      className={`tree-host-caret ${isCollapsed ? "collapsed" : ""}`}
                    >
                      ▸
                    </span>
                    <span className="tree-host-dot" />
                    <span className="tree-host-name">{h}</span>
                    <span className="tree-host-count">{eps.length}</span>
                    {findingsByHost[h] > 0 && (
                      <span
                        className="tree-host-findings"
                        title={`${findingsByHost[h]} findings`}
                      >
                        {findingsByHost[h]}
                      </span>
                    )}
                  </div>
                  {!isCollapsed &&
                    eps.map((e) => {
                      const sel = selected && selected.id === e.id;
                      return (
                        <div
                          key={e.id}
                          className={`tree-node ${sel ? "sel" : ""}`}
                          onClick={() => {
                            setSelectedHost(h);
                            void handleSelectRow(e);
                          }}
                        >
                          <Method m={e.method} />
                          <span className="tree-path">{e.path}</span>
                          {e.findings > 0 && (
                            <span
                              className="tree-finding-dot"
                              title={`${e.findings} finding(s)`}
                            />
                          )}
                        </div>
                      );
                    })}
                </div>
              );
            })
          )}
        </div>
        <div className="tree-footer">
          <span className="mono">
            {byHost.length} hosts · {totalEps} endpoints
          </span>
        </div>
      </aside>

      {/* CENTER: table */}
      <section className="sitemap-main">
        <div className="sitemap-toolbar">
          <div className="sm-host-crumb">
            <IconChevronR size={10} />
            <span className="mono">{selectedHost || "—"}</span>
            <span style={{ color: "var(--fg-3)" }}>·</span>
            <span className="mono" style={{ color: "var(--fg-2)" }}>
              {tableRows.length} endpoints
            </span>
          </div>
          <div style={{ flex: 1 }} />
          <div className="searchbar" style={{ minWidth: 220 }}>
            <IconSearch size={13} />
            <input
              placeholder="Filter path…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="filter-group">
            <span className="filter-label">METHOD</span>
            <div className="chip-row">
              {METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`chip ${methodFilter[m] ? "on" : ""}`}
                  onClick={() => toggleMethod(m)}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div className="filter-group">
            <span className="filter-label">STATUS</span>
            <div className="chip-row">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`chip ${statusFilter === s ? "on" : ""}`}
                  onClick={() => setStatusFilter(s)}
                >
                  {s === "all" ? "all" : `${s}xx`}
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="btn" onClick={handleExport}>
            <IconExport size={12} /> Export
          </button>
        </div>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 70 }}>Method</th>
                <th>Path</th>
                <th style={{ width: 80 }}>Status</th>
                <th style={{ width: 140 }}>Tech</th>
                <th style={{ width: 100 }}>Source</th>
                <th style={{ width: 90, textAlign: "right" }}>Findings</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((e) => {
                const sel = selected && selected.id === e.id;
                return (
                  <tr
                    key={e.id}
                    className={sel ? "sel" : ""}
                    onClick={() => void handleSelectRow(e)}
                  >
                    <td>
                      <Method m={e.method} />
                    </td>
                    <td className="primary">{e.path}</td>
                    <td>
                      <Status code={e.status} />
                    </td>
                    <td>{e.tech || "—"}</td>
                    <td>{e.source || "—"}</td>
                    <td className="num">{e.findings || "—"}</td>
                  </tr>
                );
              })}
              {tableRows.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    style={{
                      padding: "var(--sp-6)",
                      textAlign: "center",
                      color: "var(--fg-3)",
                    }}
                  >
                    No endpoints match your filters
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* RIGHT: inspector */}
      {selected && (
        <aside className="inspector">
          <div className="insp-header">
            <div
              className="insp-glyph"
              style={{
                background: "color-mix(in oklch, var(--kind-endpoint) 18%, transparent)",
                color: "var(--kind-endpoint)",
              }}
            >
              E
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="insp-kind">
                <Method m={selected.method} />
                <Status code={selected.status} />
              </div>
              <div className="insp-title">{selected.path}</div>
            </div>
          </div>
          <div className="insp-body">
            <div className="prop-row">
              <div className="prop-key">Host</div>
              <div className="prop-val">{selected.host}</div>
            </div>
            <div className="prop-row">
              <div className="prop-key">Title</div>
              <div className="prop-val">
                {typeof selected.raw.properties.title === "string"
                  ? selected.raw.properties.title
                  : "—"}
              </div>
            </div>
            <div className="prop-row">
              <div className="prop-key">Tech</div>
              <div className="prop-val">{selected.tech || "—"}</div>
            </div>
            <div className="prop-row">
              <div className="prop-key">Source</div>
              <div className="prop-val">{selected.source || "—"}</div>
            </div>
            <div className="prop-row">
              <div className="prop-key">Findings</div>
              <div className="prop-val num">{selected.findings}</div>
            </div>
            {response && (
              <>
                <div className="prop-row">
                  <div className="prop-key">Body size</div>
                  <div className="prop-val num">{response.body_size}</div>
                </div>
                <div className="prop-row">
                  <div className="prop-key">Content-Type</div>
                  <div className="prop-val">
                    {response.response_headers["content-type"] ||
                      response.response_headers["Content-Type"] ||
                      "—"}
                  </div>
                </div>
              </>
            )}
            <div className="insp-actions">
              <button
                type="button"
                className="insp-btn primary"
                onClick={handleOpenInGraph}
              >
                Open in graph
              </button>
              <button type="button" className="insp-btn" onClick={() => void handleRescan()}>
                Re-scan
              </button>
              <button type="button" className="insp-btn" onClick={() => void handleCurl()}>
                cURL
              </button>
              <button type="button" className="insp-btn" onClick={() => void handleCopyUrl()}>
                Copy URL
              </button>
            </div>
            {flash && (
              <div
                style={{
                  marginTop: 12,
                  padding: "6px 10px",
                  background: "var(--silk-faint)",
                  border: "1px solid var(--silk-dim)",
                  borderRadius: 4,
                  color: "var(--silk)",
                  fontSize: 11,
                  fontFamily: "var(--ff-mono)",
                }}
              >
                {flash}
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
