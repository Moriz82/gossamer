import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiJson } from "../api";

type GraphStats = { total_nodes: number; total_edges: number };
type GraphSnapshot = { nodes: { id: string; kind: string; properties?: Record<string, unknown> }[] };
type HostsResp = { hosts: string[] };
type TechInfo = {
  key: string;
  name: string;
  version: string | null;
  confidence: number;
  known_cves: unknown[];
};
type TechsResp = { technologies: TechInfo[] };
type FindingGroup = {
  template_id: string;
  name: string;
  severity: string;
  scanner: string;
  count: number;
};
type FindingsSummary = { groups: FindingGroup[]; total: number };
type SettingsResp = { effective?: { active_project?: string } };

type Range = "24h" | "7d" | "30d" | "all";

type SeverityKey = "critical" | "high" | "medium" | "low" | "info";

const SEVERITY_ROWS: { key: SeverityKey; label: string; color: string }[] = [
  { key: "critical", label: "Critical", color: "var(--sev-crit)" },
  { key: "high",     label: "High",     color: "var(--sev-high)" },
  { key: "medium",   label: "Medium",   color: "var(--sev-med)"  },
  { key: "low",      label: "Low",      color: "var(--sev-low)"  },
  { key: "info",     label: "Info",     color: "var(--sev-info)" },
];

const SEV_DISPLAY: Record<SeverityKey, "crit" | "high" | "med" | "low" | "info"> = {
  critical: "crit",
  high: "high",
  medium: "med",
  low: "low",
  info: "info",
};

function Spark({ data, color, height = 40, width = 180 }: {
  data: number[];
  color: string;
  height?: number;
  width?: number;
}) {
  if (!data.length) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const step = data.length > 1 ? width / (data.length - 1) : 0;
  const pts = data.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(" ");
  const areaPts = `0,${height} ${pts} ${width},${height}`;
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <polygon points={areaPts} fill={color} opacity="0.1" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
      {data.length > 0 ? (
        <circle
          cx={(data.length - 1) * step}
          cy={height - ((data[data.length - 1] - min) / range) * (height - 4) - 2}
          r={2.5}
          fill={color}
        />
      ) : null}
    </svg>
  );
}

function Severity({ s }: { s: "crit" | "high" | "med" | "low" | "info" }) {
  return <span className={`sev-chip ${s}`}>{s}</span>;
}

function hostnameOf(url: string): string {
  try { return new URL(url).hostname || url; } catch { return url; }
}

function severityOf(g: FindingGroup): SeverityKey {
  const s = (g.severity || "").toLowerCase();
  if (s === "critical" || s === "crit") return "critical";
  if (s === "high") return "high";
  if (s === "medium" || s === "med") return "medium";
  if (s === "low") return "low";
  return "info";
}

export default function IntelPanel() {
  const [range, setRange] = useState<Range>("24h");
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [endpointCount, setEndpointCount] = useState<number | null>(null);
  const [hosts, setHosts] = useState<string[]>([]);
  const [techs, setTechs] = useState<TechInfo[]>([]);
  const [findings, setFindings] = useState<FindingGroup[]>([]);
  const [project, setProject] = useState<string>("");

  const refresh = useCallback(async () => {
    const results = await Promise.allSettled([
      apiJson<GraphStats>("/api/graph/stats"),
      apiJson<GraphSnapshot>("/api/graph?kinds=Endpoint&limit=5000"),
      apiJson<HostsResp>("/api/graph/hosts"),
      apiJson<TechsResp>("/api/technologies"),
      apiJson<FindingsSummary>("/api/findings/summary"),
      apiJson<SettingsResp>("/api/settings"),
    ]);
    const [statsR, epR, hostsR, techsR, findR, settingsR] = results;
    if (statsR.status === "fulfilled") setStats(statsR.value);
    if (epR.status === "fulfilled") {
      setEndpointCount(epR.value.nodes.filter(n => n.kind === "Endpoint").length);
    }
    if (hostsR.status === "fulfilled") setHosts(hostsR.value.hosts);
    if (techsR.status === "fulfilled") setTechs(techsR.value.technologies);
    if (findR.status === "fulfilled") setFindings(findR.value.groups || []);
    if (settingsR.status === "fulfilled") {
      setProject(settingsR.value.effective?.active_project || "default");
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const sevCounts = useMemo(() => {
    const c: Record<SeverityKey, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const g of findings) c[severityOf(g)] += g.count;
    return c;
  }, [findings]);

  const totalFindings = useMemo(
    () => Object.values(sevCounts).reduce((a, b) => a + b, 0),
    [sevCounts],
  );

  const topTechs = useMemo(() => {
    const max = Math.max(100, ...techs.map(t => t.confidence));
    return techs.slice(0, 8).map((t, i) => ({
      name: t.version ? `${t.name} ${t.version}` : t.name,
      n: t.confidence,
      max,
      hue: (i * 37) % 360,
    }));
  }, [techs]);

  const hostsInScope = useMemo(
    () => hosts.slice(0, 8).map(url => ({ url, host: hostnameOf(url) })),
    [hosts],
  );

  const attackPaths = useMemo(() => {
    const sevRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    const sorted = [...findings].sort((a, b) =>
      (sevRank[severityOf(a)] ?? 9) - (sevRank[severityOf(b)] ?? 9)
    );
    return sorted.slice(0, 4).map(f => {
      const sev = severityOf(f);
      return {
        from: "Internet",
        to: f.name || f.template_id,
        hops: sev === "critical" ? 1 : sev === "high" ? 2 : 3,
        sev: SEV_DISPLAY[sev],
      };
    });
  }, [findings]);

  const endpointsTotal = endpointCount ?? stats?.total_nodes ?? 0;
  const hostsTotal = hosts.length;

  // Sparklines: no time-series backend, derive small arrays from current totals.
  const endpointSpark = [0, 0, 0, 0, 0, 0, endpointsTotal];
  const hostsSpark = [0, 0, 0, 0, 0, 0, hostsTotal];
  const findingsSpark = [
    0,
    sevCounts.info,
    sevCounts.info + sevCounts.low,
    sevCounts.info + sevCounts.low + sevCounts.medium,
    sevCounts.info + sevCounts.low + sevCounts.medium + sevCounts.high,
    totalFindings,
    totalFindings,
  ];
  const pathsSpark = [0, 0, 0, 0, 0, 0, attackPaths.length];

  const findingsDeltaColor = sevCounts.critical > 0
    ? "var(--sev-crit)"
    : sevCounts.high > 0
      ? "var(--sev-high)"
      : "var(--fg-2)";

  const findingsDelta = (() => {
    const parts: ReactNode[] = [];
    if (sevCounts.critical > 0) {
      parts.push(<span key="c" style={{ color: "var(--sev-crit)" }}>{sevCounts.critical} critical</span>);
    }
    if (sevCounts.high > 0) {
      parts.push(<span key="h" style={{ color: "var(--sev-high)" }}>{sevCounts.high} high</span>);
    }
    if (parts.length === 0) {
      return <span>{totalFindings === 0 ? "no findings" : `${totalFindings} total`}</span>;
    }
    return parts.flatMap((p, i) =>
      i === 0 ? [p] : [<span key={`sep-${i}`}> · </span>, p]
    );
  })();

  const chips: Range[] = ["24h", "7d", "30d", "all"];

  return (
    <div className="screen">
      <div className="screen-header">
        <h1 className="screen-title">Intel</h1>
        <span className="screen-sub">Project overview · {project || "—"}</span>
        <div style={{ flex: 1 }} />
        <div className="chip-row">
          {chips.map(c => (
            <button
              key={c}
              type="button"
              className={`chip ${range === c ? "on" : ""}`}
              onClick={() => setRange(c)}
            >
              {c === "all" ? "All" : c}
            </button>
          ))}
        </div>
      </div>

      <div className="screen-body" style={{ overflow: "auto" }}>
        <div className="intel">
          <div className="card col-3">
            <div className="card-title">Endpoints</div>
            <div className="stat-big">{endpointsTotal}</div>
            <div className="stat-delta">
              <span>{stats ? `${stats.total_edges} edges` : "graph"}</span>
            </div>
            <Spark data={endpointSpark} color="oklch(80% 0.10 220)" />
          </div>

          <div className="card col-3">
            <div className="card-title">Hosts</div>
            <div className="stat-big">{hostsTotal}</div>
            <div className="stat-delta">
              {hostsTotal === 0 ? "none in scope" : `${hostsTotal} in scope`}
            </div>
            <Spark data={hostsSpark} color="oklch(78% 0.14 160)" />
          </div>

          <div className="card col-3">
            <div className="card-title">Findings</div>
            <div className="stat-big" style={{ color: findingsDeltaColor }}>
              {totalFindings}
            </div>
            <div className="stat-delta">{findingsDelta}</div>
            <Spark data={findingsSpark} color="var(--sev-high)" />
          </div>

          <div className="card col-3">
            <div className="card-title">Attack paths</div>
            <div className="stat-big">{attackPaths.length}</div>
            <div className="stat-delta">
              {attackPaths.length > 0
                ? <span className="up">derived from findings</span>
                : <span>no paths</span>}
            </div>
            <Spark data={pathsSpark} color="oklch(78% 0.14 300)" />
          </div>

          <div className="card col-6">
            <div className="card-title">
              Findings by severity{" "}
              <span style={{ color: "var(--fg-3)" }}>· {totalFindings} total</span>
            </div>
            <div style={{ marginTop: 8 }}>
              {SEVERITY_ROWS.map(r => {
                const n = sevCounts[r.key];
                const max = Math.max(1, totalFindings);
                return (
                  <div key={r.key} className="bar-row">
                    <div className="br-l">{r.label}</div>
                    <div className="br-track">
                      <div className="br-fill" style={{ width: `${(n / max) * 100}%`, background: r.color }} />
                    </div>
                    <div className="br-n" style={{ color: r.color }}>{n}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card col-6">
            <div className="card-title">Top technologies</div>
            <div style={{ marginTop: 8 }}>
              {topTechs.length === 0 && (
                <div className="intel-empty">No technologies detected yet.</div>
              )}
              {topTechs.map(t => (
                <div key={t.name} className="bar-row">
                  <div className="br-l" title={t.name}>{t.name}</div>
                  <div className="br-track">
                    <div
                      className="br-fill"
                      style={{
                        width: `${(t.n / t.max) * 100}%`,
                        background: `oklch(78% 0.10 ${t.hue})`,
                      }}
                    />
                  </div>
                  <div className="br-n">{t.n}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card col-6">
            <div className="card-title">Hosts in scope</div>
            <div style={{ marginTop: 6 }}>
              {hostsInScope.length === 0 && (
                <div className="intel-empty">No hosts in scope. Run a crawl first.</div>
              )}
              {hostsInScope.map(h => (
                <div key={h.url} className="target-row">
                  <span
                    className="tree-host-dot"
                    style={{ background: "var(--kind-host)", boxShadow: "0 0 6px var(--kind-host)" }}
                  />
                  <span className="tr-host">{h.host}</span>
                  <span className="tr-meta">{h.url}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card col-6">
            <div className="card-title">
              Top attack paths{" "}
              <span style={{ color: "var(--fg-3)" }}>· shortest chain to sensitive assets</span>
            </div>
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              {attackPaths.length === 0 && (
                <div className="intel-empty">No attack paths yet. Run scanners to surface findings.</div>
              )}
              {attackPaths.map((p, i) => (
                <div key={i} className="intel-path-row">
                  <Severity s={p.sev} />
                  <span className="ip-from">{p.from}</span>
                  <span className="ip-arrow">─ {p.hops} hops →</span>
                  <span className="ip-to">{p.to}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
