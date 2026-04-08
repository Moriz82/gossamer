import { useCallback, useEffect, useMemo, useState } from "react";
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

type TreeNode = {
  segment: string;
  fullPath: string;
  children: Map<string, TreeNode>;
  endpoints: EndpointNode[];
  count: number;
};

function buildTree(endpoints: EndpointNode[]): Map<string, TreeNode> {
  const hostMap = new Map<string, TreeNode>();

  for (const ep of endpoints) {
    const url = ep.properties.url;
    if (!url) continue;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    const host = parsed.hostname;
    if (!hostMap.has(host)) {
      hostMap.set(host, {
        segment: host,
        fullPath: host,
        children: new Map(),
        endpoints: [],
        count: 0,
      });
    }
    const hostNode = hostMap.get(host)!;
    hostNode.count++;

    const pathParts = parsed.pathname.split("/").filter(Boolean);
    let current = hostNode;
    let builtPath = "";

    for (const part of pathParts) {
      builtPath += "/" + part;
      if (!current.children.has(part)) {
        current.children.set(part, {
          segment: part,
          fullPath: builtPath,
          children: new Map(),
          endpoints: [],
          count: 0,
        });
      }
      current = current.children.get(part)!;
      current.count++;
    }
    current.endpoints.push(ep);
  }
  return hostMap;
}

function statusColor(code: number | undefined | null): string {
  if (!code) return "var(--fg-dim, #666)";
  if (code >= 200 && code < 300) return "#4caf50";
  if (code >= 300 && code < 400) return "#ff9800";
  if (code >= 400 && code < 500) return "#f44336";
  if (code >= 500) return "#e91e63";
  return "var(--fg-dim, #666)";
}

function methodBadge(method: string | undefined): string {
  return (method || "GET").toUpperCase();
}

function TreeItem({
  node,
  depth,
  onSelect,
  selectedId,
}: {
  node: TreeNode;
  depth: number;
  onSelect: (ep: EndpointNode) => void;
  selectedId: string | null;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children.size > 0 || node.endpoints.length > 0;

  return (
    <div className="tree-item" style={{ paddingLeft: depth * 14 }}>
      <div
        className="tree-item-header"
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        <span className="tree-expand">{hasChildren ? (expanded ? "\u25BC" : "\u25B6") : "\u00B7"}</span>
        <span className="tree-segment">{node.segment}</span>
        <span className="badge tree-count">{node.count}</span>
      </div>
      {expanded && (
        <>
          {Array.from(node.children.values()).map((child) => (
            <TreeItem
              key={child.fullPath}
              node={child}
              depth={depth + 1}
              onSelect={onSelect}
              selectedId={selectedId}
            />
          ))}
          {node.endpoints.map((ep) => (
            <div
              key={ep.id}
              className={`tree-endpoint ${selectedId === ep.id ? "tree-endpoint-active" : ""}`}
              style={{ paddingLeft: (depth + 1) * 14 }}
              onClick={() => onSelect(ep)}
            >
              <span
                className="tree-method"
                data-method={methodBadge(ep.properties.method)}
              >
                {methodBadge(ep.properties.method)}
              </span>
              <span
                className="tree-status"
                style={{ color: statusColor(ep.properties.status_code) }}
              >
                {ep.properties.status_code || "\u2014"}
              </span>
              <span className="tree-url">
                {(() => {
                  try {
                    return new URL(ep.properties.url || "").pathname;
                  } catch {
                    return ep.properties.url || "";
                  }
                })()}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export default function SitemapPanel() {
  const [endpoints, setEndpoints] = useState<EndpointNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<EndpointNode | null>(null);
  const [response, setResponse] = useState<ResponseData | null>(null);
  const [responseLoading, setResponseLoading] = useState(false);
  const [responseTab, setResponseTab] = useState<"request" | "response">("response");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    setLoading(true);
    apiJson<GraphData>("/api/graph?kinds=Host,Endpoint")
      .then((data) => {
        setEndpoints(data.nodes.filter((n) => n.kind === "Endpoint"));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const tree = useMemo(() => {
    const filtered = filter
      ? endpoints.filter((ep) =>
          (ep.properties.url || "").toLowerCase().includes(filter.toLowerCase())
        )
      : endpoints;
    return buildTree(filtered);
  }, [endpoints, filter]);

  const handleSelect = useCallback(
    async (ep: EndpointNode) => {
      setSelected(ep);
      setResponse(null);
      const rid = ep.properties.response_id;
      if (!rid) return;
      setResponseLoading(true);
      try {
        const data = await apiJson<ResponseData>(`/api/responses/${rid}`);
        setResponse(data);
      } catch {
        /* no response stored */
      } finally {
        setResponseLoading(false);
      }
    },
    []
  );

  if (loading) return <p className="panel-msg">Loading sitemap...</p>;

  return (
    <div className="sitemap-panel">
      <div className="sitemap-tree">
        <div className="sitemap-tree-header">
          <h3>Sitemap</h3>
          <span className="badge">{endpoints.length} endpoints</span>
        </div>
        <div className="sitemap-filter">
          <input
            type="text"
            placeholder="Filter URLs..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="sitemap-tree-body">
          {tree.size === 0 ? (
            <p className="empty-hint">No endpoints found. Run a crawl first.</p>
          ) : (
            Array.from(tree.values()).map((host) => (
              <TreeItem
                key={host.segment}
                node={host}
                depth={0}
                onSelect={handleSelect}
                selectedId={selected?.id || null}
              />
            ))
          )}
        </div>
      </div>
      <div className="sitemap-detail">
        {!selected ? (
          <div className="sitemap-detail-empty">
            <p>Select an endpoint to view details</p>
          </div>
        ) : (
          <>
            <div className="sitemap-detail-header">
              <span className="tree-method" data-method={methodBadge(selected.properties.method)}>
                {methodBadge(selected.properties.method)}
              </span>
              <span className="sitemap-detail-url">{selected.properties.url}</span>
              <span
                className="tree-status"
                style={{ color: statusColor(selected.properties.status_code) }}
              >
                {selected.properties.status_code || "\u2014"}
              </span>
            </div>
            <div className="sitemap-detail-tabs">
              <button
                type="button"
                className={responseTab === "request" ? "sidebar-tab active" : "sidebar-tab"}
                onClick={() => setResponseTab("request")}
              >
                Request
              </button>
              <button
                type="button"
                className={responseTab === "response" ? "sidebar-tab active" : "sidebar-tab"}
                onClick={() => setResponseTab("response")}
              >
                Response
              </button>
            </div>
            {responseLoading ? (
              <p className="muted">Loading response...</p>
            ) : !response ? (
              <div className="sitemap-detail-props">
                <h4>Endpoint Properties</h4>
                {Object.entries(selected.properties).map(([k, v]) => (
                  <div key={k} className="inspector-prop">
                    <span className="inspector-prop-key">{k}</span>
                    <span className="inspector-prop-val">{String(v)}</span>
                  </div>
                ))}
                <p className="muted" style={{marginTop: 12}}>No stored HTTP response available.</p>
              </div>
            ) : responseTab === "request" ? (
              <div className="sitemap-detail-body">
                <div className="response-section">
                  <h4>{response.method} {response.url}</h4>
                  <table className="response-headers-table">
                    <thead><tr><th>Header</th><th>Value</th></tr></thead>
                    <tbody>
                      {Object.entries(response.request_headers).map(([k, v]) => (
                        <tr key={k}><td>{k}</td><td>{v}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="sitemap-detail-body">
                <div className="response-section">
                  <h4>Status: {response.status}</h4>
                  <table className="response-headers-table">
                    <thead><tr><th>Header</th><th>Value</th></tr></thead>
                    <tbody>
                      {Object.entries(response.response_headers).map(([k, v]) => (
                        <tr key={k}><td>{k}</td><td>{v}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {response.body && (
                  <div className="response-body-section">
                    <div className="response-body-header">
                      <h4>Body ({response.body_size} bytes)</h4>
                      <button type="button" className="ghost" onClick={() => navigator.clipboard.writeText(response.body || "")}>Copy</button>
                    </div>
                    <pre className="response-body">{response.body.slice(0, 50000)}</pre>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
