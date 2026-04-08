import { useCallback, useEffect, useState } from "react";
import { apiJson, apiFetch } from "../api";

type Suggestion = {
  id: string;
  priority: string;
  category: string;
  title: string;
  detail: string;
  evidence: string[];
  actions: { label: string; type: string; cve_id?: string; tool_id?: string; tool?: string; tags?: string }[];
  related_nodes: string[];
};

type TechInfo = {
  key: string;
  name: string;
  version: string | null;
  confidence: number;
  categories: number[];
  cpe: string | null;
  evidence: string[];
  known_cves: any[];
};

type FindingGroup = {
  template_id: string;
  name: string;
  severity: string;
  scanner: string;
  count: number;
};

const PRIO_COLORS: Record<string, string> = {
  critical: "#dc2626",
  high: "#ea580c",
  medium: "#d97706",
  low: "#2563eb",
  info: "#6b7280",
};

const PRIO_ORDER = ["critical", "high", "medium", "low", "info"];

export default function IntelPanel() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [techs, setTechs] = useState<TechInfo[]>([]);
  const [findings, setFindings] = useState<FindingGroup[]>([]);
  const [filterPrio, setFilterPrio] = useState<string | null>(null);
  const [filterCat, setFilterCat] = useState<string | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [runningTool, setRunningTool] = useState<string | null>(null);
  const [toolOutput, setToolOutput] = useState<string[]>([]);

  const refresh = useCallback(() => {
    setLoading(true);
    Promise.all([
      apiJson<{ suggestions: Suggestion[]; counts: Record<string, number> }>("/api/suggestions"),
      apiJson<{ technologies: TechInfo[] }>("/api/technologies"),
      apiJson<{ groups: FindingGroup[]; total: number }>("/api/findings/summary"),
    ]).then(([s, t, f]) => {
      setSuggestions(s.suggestions);
      setCounts(s.counts);
      setTechs(t.technologies);
      setFindings(f.groups || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function enrichCVEs() {
    setEnriching(true);
    try {
      const r = await apiJson<{ ok: boolean; technologies_enriched: number; total_cves: number }>(
        "/api/technologies/enrich", { method: "POST" }
      );
      if (r.ok) {
        alert(`Enriched ${r.technologies_enriched} technologies with ${r.total_cves} CVEs`);
        refresh();
      }
    } catch (e) { alert(String(e)); }
    finally { setEnriching(false); }
  }

  async function runTool(toolId: string, targets?: string[]) {
    // Local scanners (gitleaks, trivy, grype, semgrep) need local files.
    // Use fetch-and-scan to download content first, then run the scanner.
    const LOCAL_TOOLS = new Set(["gitleaks", "trivy", "grype", "semgrep"]);
    if (LOCAL_TOOLS.has(toolId)) {
      return runFetchAndScan(toolId);
    }

    setRunningTool(toolId);
    setToolOutput([`Running ${toolId}...`]);
    try {
      let tgts = targets;
      if (!tgts) {
        const hosts = await apiJson<{hosts: string[]}>("/api/graph/hosts");
        tgts = hosts.hosts.length > 0 ? [hosts.hosts[0]] : ["."];
      }
      const r = await apiFetch("/api/tools/run", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool_id: toolId, targets: tgts, extra_args: [] }),
      });
      if (!r.ok) throw new Error(await r.text());
      const reader = r.body?.getReader();
      if (!reader) throw new Error("No body");
      const decoder = new TextDecoder(); let buf = "";
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n"); buf = parts.pop() || "";
        for (const part of parts) {
          const line = part.replace(/^data: /, "").trim(); if (!line) continue;
          try {
            const evt = JSON.parse(line) as any;
            if (evt.type === "progress" && evt.output) {
              setToolOutput(prev => [...prev.slice(-50), evt.output]);
            } else if (evt.type === "complete") {
              if (evt.ingested) setToolOutput(prev => [...prev, `Done: ${evt.ingested.nodes} nodes, ${evt.ingested.edges} edges`]);
              else if (evt.error) setToolOutput(prev => [...prev, `Error: ${evt.error}`]);
              else setToolOutput(prev => [...prev, `Done (exit ${evt.exit_code ?? "?"})`]);
            } else if (evt.type === "error") {
              setToolOutput(prev => [...prev, `Error: ${evt.detail}`]);
            }
          } catch { /* skip */ }
        }
      }
      refresh(); // Refresh suggestions after scan
    } catch (err) { setToolOutput(prev => [...prev, `Error: ${err}`]); }
    finally { setRunningTool(null); }
  }

  async function runFetchAndScan(toolId: string) {
    setRunningTool(toolId);
    setToolOutput([`Fetching web content and running ${toolId}...`]);
    try {
      const hosts = await apiJson<{hosts: string[]}>("/api/graph/hosts");
      const target = hosts.hosts[0] || "";
      if (!target) { setToolOutput(["No hosts in graph. Run a crawl first."]); setRunningTool(null); return; }

      const r = await apiFetch("/api/scan/fetch-and-scan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base_url: target, scanner_ids: [toolId] }),
      });
      if (!r.ok) throw new Error(await r.text());
      const reader = r.body?.getReader();
      if (!reader) throw new Error("No body");
      const decoder = new TextDecoder(); let buf = "";
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n"); buf = parts.pop() || "";
        for (const part of parts) {
          const line = part.replace(/^data: /, "").trim(); if (!line) continue;
          try {
            const evt = JSON.parse(line) as any;
            if (evt.type === "status") setToolOutput(prev => [...prev.slice(-50), evt.detail]);
            else if (evt.type === "scanner_start") setToolOutput(prev => [...prev, `Starting ${evt.scanner}...`]);
            else if (evt.type === "scanner_done") {
              if (evt.ingested) setToolOutput(prev => [...prev, `Done: ${evt.ingested.nodes} nodes, ${evt.ingested.edges} edges`]);
              else if (evt.error) setToolOutput(prev => [...prev, `Error: ${evt.error}`]);
              else setToolOutput(prev => [...prev, `Done (exit ${evt.exit_code ?? "?"})`]);
            }
            else if (evt.type === "complete") {
              if (evt.ok) setToolOutput(prev => [...prev, `Scan complete (${evt.files} files scanned)`]);
              else setToolOutput(prev => [...prev, `Failed: ${evt.error || "unknown error"}`]);
            }
            else if (evt.type === "error") setToolOutput(prev => [...prev, `Error: ${evt.detail}`]);
          } catch { /* skip */ }
        }
      }
      refresh();
    } catch (err) { setToolOutput(prev => [...prev, `Error: ${err}`]); }
    finally { setRunningTool(null); }
  }

  const filtered = suggestions.filter(s => {
    if (filterPrio && s.priority !== filterPrio) return false;
    if (filterCat && s.category !== filterCat) return false;
    return true;
  });

  const categories = [...new Set(suggestions.map(s => s.category))].sort();

  return (
    <div className="intel-panel">
      {/* Header bar */}
      <div className="intel-header">
        <div className="intel-header-left">
          <h2 className="intel-title">Attack Surface Intelligence</h2>
          <span className="intel-subtitle">{techs.length} technologies, {suggestions.length} suggestions</span>
        </div>
        <div className="intel-header-actions">
          <button className="primary" onClick={enrichCVEs} disabled={enriching}>
            {enriching ? "Looking up CVEs..." : "Enrich CVEs"}
          </button>
          <button onClick={refresh} disabled={loading}>{loading ? "..." : "Refresh"}</button>
        </div>
      </div>

      <div className="intel-body">
        {/* Left: Technologies */}
        <div className="intel-techs">
          <div className="intel-section-head">Detected Technologies</div>
          {techs.length === 0 && <p className="intel-empty">No technologies detected. Run a crawl first.</p>}
          {techs.map(t => (
            <div key={t.key} className="intel-tech-card">
              <div className="intel-tech-name">
                {t.name} {t.version && <span className="intel-tech-ver">{t.version}</span>}
              </div>
              <div className="intel-tech-meta">
                <span className="intel-confidence" style={{opacity: t.confidence / 100}}>
                  {t.confidence}% confidence
                </span>
                {t.cpe && <span className="intel-cpe">{t.cpe.split(":").slice(3, 5).join(" ")}</span>}
                {t.known_cves && t.known_cves.length > 0 && (
                  <span className="intel-cve-badge" style={{color: PRIO_COLORS.high}}>
                    {t.known_cves.length} CVEs
                  </span>
                )}
              </div>
              {t.evidence.length > 0 && (
                <div className="intel-tech-evidence">
                  {t.evidence.map((e, i) => <span key={i} className="intel-evidence-tag">{e}</span>)}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Right: Suggestions */}
        <div className="intel-suggestions">
          <div className="intel-section-head">
            Suggestions
            <div className="intel-filters">
              {PRIO_ORDER.map(p => (
                <button key={p}
                  className={`intel-prio-pill ${filterPrio === p ? "active" : ""}`}
                  style={{ "--prio-color": PRIO_COLORS[p] } as React.CSSProperties}
                  onClick={() => setFilterPrio(filterPrio === p ? null : p)}>
                  {p} {counts[p] || 0}
                </button>
              ))}
              <select value={filterCat || ""} onChange={e => setFilterCat(e.target.value || null)}
                style={{marginLeft: 8, fontSize: "0.72rem"}}>
                <option value="">All categories</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {filtered.length === 0 && <p className="intel-empty">
            {suggestions.length === 0
              ? "No suggestions yet. Run a crawl and click 'Enrich CVEs' to generate intelligence."
              : "No suggestions match the current filters."}
          </p>}

          {filtered.map(s => (
            <div key={s.id} className={`intel-card intel-card-${s.priority}`}>
              <div className="intel-card-header">
                <span className="intel-prio-badge" style={{background: PRIO_COLORS[s.priority]}}>
                  {s.priority}
                </span>
                <span className="intel-card-cat">{s.category}</span>
                <span className="intel-card-title">{s.title}</span>
              </div>
              <div className="intel-card-detail">{s.detail}</div>
              {s.evidence.length > 0 && (
                <div className="intel-card-evidence">
                  {s.evidence.map((e, i) => <span key={i} className="intel-evidence-tag">{e}</span>)}
                </div>
              )}
              {s.actions.length > 0 && (
                <div className="intel-card-actions">
                  {s.actions.map((a, i) => (
                    <button key={i} className="ghost intel-action-btn" title={a.type}
                      disabled={runningTool !== null}
                      onClick={() => {
                        if (a.type === "run_tool" && a.tool_id) void runTool(a.tool_id);
                        else if (a.type === "scan" && a.tool_id) void runTool(a.tool_id);
                      }}>
                      {runningTool === (a.tool_id || a.tool) ? "Running..." : a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* Scanner findings section */}
          {findings.length > 0 && (
            <>
              <div className="intel-section-head" style={{marginTop: 20}}>Scanner Findings</div>
              {findings.map(f => (
                <div key={f.template_id} className={`intel-card intel-card-${f.severity}`}>
                  <div className="intel-card-header">
                    <span className="intel-prio-badge" style={{background: PRIO_COLORS[f.severity] || PRIO_COLORS.info}}>
                      {f.severity}
                    </span>
                    <span className="intel-card-cat">{f.scanner}</span>
                    <span className="intel-card-title">{f.name || f.template_id}</span>
                    <span className="intel-card-cat" style={{marginLeft: "auto"}}>{f.count}x</span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Tool output modal */}
      {toolOutput.length > 0 && (
        <div className="intel-tool-output">
          <div className="intel-tool-header">
            <span>{runningTool ? `Running ${runningTool}...` : "Tool output"}</span>
            {!runningTool && <button className="ghost" onClick={() => setToolOutput([])}>Close</button>}
          </div>
          <pre className="intel-tool-pre">
            {toolOutput.map((l, i) => <div key={i}>{l}</div>)}
          </pre>
        </div>
      )}
    </div>
  );
}
