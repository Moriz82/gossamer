import { useEffect, useState } from "react";
import { apiJson } from "../api";

type FindingGroup = {
  template_id: string;
  name: string;
  severity: string;
  scanner: string;
  count: number;
};

type FindingSummary = {
  groups: FindingGroup[];
  total: number;
};

const SEV_COLORS: Record<string, string> = {
  critical: "#e91e63",
  high: "#f44336",
  medium: "#ff9800",
  low: "#4caf50",
  info: "#2196f3",
};

function sevBadge(sev: string) {
  const color = SEV_COLORS[sev] || "#888";
  return <span className="findings-sev" style={{ backgroundColor: color }}>{sev}</span>;
}

export default function FindingsPanel() {
  const [summary, setSummary] = useState<FindingSummary | null>(null);
  const [filter, setFilter] = useState("");
  const [sevFilter, setSevFilter] = useState<string>("all");

  useEffect(() => {
    apiJson<FindingSummary>("/api/findings/summary").then(setSummary).catch(() => {});
  }, []);

  if (!summary) return <div className="panel-block"><p className="muted">Loading findings...</p></div>;

  const sevCounts: Record<string, number> = {};
  summary.groups.forEach(g => {
    sevCounts[g.severity] = (sevCounts[g.severity] || 0) + g.count;
  });

  const filtered = summary.groups.filter(g => {
    if (sevFilter !== "all" && g.severity !== sevFilter) return false;
    if (filter) {
      const q = filter.toLowerCase();
      return g.name?.toLowerCase().includes(q) || g.template_id?.toLowerCase().includes(q) || g.scanner?.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="panel-block">
      <div className="card">
        <h2>Findings</h2>
        <div className="findings-summary">
          <span className="findings-total">{summary.total} total findings</span>
          <span className="findings-groups">{summary.groups.length} unique types</span>
        </div>
        <div className="findings-sev-bar">
          <button type="button" className={`pill ${sevFilter === "all" ? "pill-active" : ""}`} onClick={() => setSevFilter("all")}>All ({summary.total})</button>
          {Object.entries(sevCounts).map(([sev, count]) => (
            <button key={sev} type="button" className={`pill ${sevFilter === sev ? "pill-active" : ""}`} onClick={() => setSevFilter(sev)}>
              {sev} ({count})
            </button>
          ))}
        </div>
        <input type="text" className="plugin-search" placeholder="Filter findings..." value={filter} onChange={e => setFilter(e.target.value)} style={{marginBottom: 12, maxWidth: 400}} />
        <div className="findings-table-wrap">
          <table className="findings-table">
            <thead>
              <tr>
                <th>Severity</th>
                <th>Finding</th>
                <th>Scanner</th>
                <th style={{textAlign: "right"}}>Count</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(g => (
                <tr key={g.template_id}>
                  <td>{sevBadge(g.severity)}</td>
                  <td>
                    <div className="findings-name">{g.name || g.template_id}</div>
                    <div className="findings-tid">{g.template_id}</div>
                  </td>
                  <td><code>{g.scanner}</code></td>
                  <td style={{textAlign: "right"}}><span className="badge">{g.count}</span></td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={4} className="muted" style={{textAlign: "center", padding: 20}}>No findings match your filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
