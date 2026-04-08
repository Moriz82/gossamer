import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, apiJson } from "../api";

type LogEntry = { ts: string; phase: string; msg: string; level: "info" | "warn" | "error" | "success" };
type CrawlProgress = {
  type: string; visited?: number; queue_size?: number; max_pages?: number;
  depth?: number; max_depth?: number; current_url?: string;
  nodes?: number; edges?: number; detail?: string; scanner?: string; phase?: string;
};
type PresetInfo = { name: string; description: string; audit: boolean; scanner_summary: string };
type Wordlist = { path: string; name: string; relative: string; category: string; lines: number; size_bytes: number };

const WEB_SCANNERS = [
  { id: "nuclei", label: "Nuclei", desc: "Template-based vulnerability scanner" },
];
const LOCAL_SCANNERS = [
  { id: "trivy", label: "Trivy", desc: "Container/filesystem vulnerability scanner" },
  { id: "gitleaks", label: "Gitleaks", desc: "Git secret scanning" },
  { id: "grype", label: "Grype", desc: "SCA vulnerability scanner" },
  { id: "semgrep", label: "Semgrep", desc: "Static analysis (SAST)" },
];

function ts() { return new Date().toLocaleTimeString(); }

/* ═══════════════════════════════════════════════════════════════════
   Main OperationsPanel — three tabs: Crawl, Fuzz, Scan
   ═══════════════════════════════════════════════════════════════════ */
export default function OperationsPanel() {
  const [activeTab, setActiveTab] = useState<"crawl" | "fuzz" | "scan">("crawl");

  return (
    <div className="ops-panel">
      <div className="ops-tabs">
        {(["crawl", "fuzz", "scan"] as const).map(t => (
          <button key={t} className={`ops-tab ${activeTab === t ? "ops-tab-active" : ""}`}
            onClick={() => setActiveTab(t)}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
        ))}
      </div>
      <div className="ops-tab-body">
        {activeTab === "crawl" && <CrawlTab />}
        {activeTab === "fuzz" && <FuzzTab />}
        {activeTab === "scan" && <ScanTab />}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Crawl Tab — seeds, depth, pages, scope, audit, activity log
   ═══════════════════════════════════════════════════════════════════ */
function CrawlTab() {
  const [crawlSeeds, setCrawlSeeds] = useState("");
  const [crawlSource, setCrawlSource] = useState("crawl");
  const [maxDepth, setMaxDepth] = useState("3");
  const [maxPages, setMaxPages] = useState("100");
  const [scopeHosts, setScopeHosts] = useState("");
  const [audit, setAudit] = useState(true);
  const [busy, setBusy] = useState(false);
  const [crawlProgress, setCrawlProgress] = useState<CrawlProgress | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const log = useCallback((phase: string, msg: string, level: LogEntry["level"] = "info") => {
    setLogs(prev => [...prev, { ts: ts(), phase, msg, level }]);
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  // Import helpers
  const [ingestorNames, setIngestorNames] = useState<string[]>([]);
  const [path, setPath] = useState("");
  const [sourceLabel, setSourceLabel] = useState("import");
  const [hint, setHint] = useState("");
  useEffect(() => { apiJson<{ name: string }[]>("/api/ingestors").then(r => setIngestorNames(r.map(x => x.name))).catch(() => {}); }, []);

  async function onUpload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = (e.currentTarget.elements.namedItem("file") as HTMLInputElement);
    const file = input.files?.[0]; if (!file) return;
    setBusy(true); log("ingest", `Uploading ${file.name}...`);
    const fd = new FormData(); fd.append("file", file);
    const q = new URLSearchParams({ source_label: sourceLabel }); if (hint) q.set("ingestor_hint", hint);
    try {
      const r = await apiFetch(`/api/ingest?${q}`, { method: "POST", body: fd });
      const j = await r.json(); if (!r.ok) throw new Error(j.detail || JSON.stringify(j));
      log("ingest", `Ingested: ${j.nodes} nodes, ${j.edges} edges`, "success"); input.value = "";
    } catch (err) { log("ingest", String(err), "error"); } finally { setBusy(false); }
  }
  async function ingestByPath() {
    setBusy(true); log("ingest", `Ingesting ${path}...`);
    try {
      const j = await apiJson<any>("/api/ingest/path", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, source_label: sourceLabel, ingestor_hint: hint || null }),
      });
      log("ingest", `Done: ${j.nodes} nodes, ${j.edges} edges`, "success");
    } catch (err) { log("ingest", String(err), "error"); } finally { setBusy(false); }
  }

  async function runCrawl() {
    if (!crawlSeeds) return;
    setBusy(true); setCrawlProgress(null); log("crawl", `Starting crawl of ${crawlSeeds}`);
    const reqBody: Record<string, unknown> = {
      seeds_file: crawlSeeds, source_label: crawlSource,
      crawl_mode: audit ? "crawl_audit" : "crawl_only",
      modules: [], // no fuzz/scan modules — crawl only
    };
    if (maxDepth) reqBody.max_depth = Number(maxDepth);
    if (maxPages) reqBody.max_pages = Number(maxPages);
    const lines = scopeHosts.split("\n").map(s => s.trim()).filter(Boolean);
    if (lines.length) reqBody.scope_hosts = lines;

    const ac = new AbortController(); abortRef.current = ac;
    try {
      const r = await apiFetch("/api/ingest/crawl/stream", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody), signal: ac.signal,
      });
      if (!r.ok) throw new Error(await r.text() || r.statusText);
      const reader = r.body?.getReader(); if (!reader) throw new Error("No response body");
      const decoder = new TextDecoder(); let buf = "";
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n"); buf = parts.pop() || "";
        for (const part of parts) {
          const line = part.replace(/^data: /, "").trim(); if (!line) continue;
          try {
            const evt = JSON.parse(line) as any;
            if (evt.type === "progress") {
              setCrawlProgress(evt);
              if (evt.current_url) log("crawl", `[${evt.visited}/${evt.max_pages}] ${evt.current_url}`);
            } else if (evt.type === "crawl_complete") {
              setCrawlProgress(null);
              log("crawl", `Crawl complete: ${evt.nodes} nodes, ${evt.edges} edges`, "success");
            } else if (evt.type === "complete") {
              setCrawlProgress(null);
              log("crawl", `Done: ${evt.nodes} nodes, ${evt.edges} edges`, "success");
            } else if (evt.type === "error") {
              setCrawlProgress(null); log("crawl", `Error: ${evt.detail}`, "error");
            }
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") log("crawl", String(err), "error");
      setCrawlProgress(null);
    } finally { setBusy(false); abortRef.current = null; }
  }

  async function clearGraph() {
    if (!confirm("Clear all nodes and edges?")) return;
    setBusy(true); log("system", "Clearing graph...");
    try { await apiJson("/api/graph", { method: "DELETE" }); log("system", "Graph cleared", "success"); }
    catch (err) { log("system", String(err), "error"); } finally { setBusy(false); }
  }

  return (
    <div className="ops-crawl-layout">
      <div className="ops-config">
        <datalist id="ingestor-hints">{ingestorNames.map(n => <option key={n} value={n} />)}</datalist>
        <details className="ops-section">
          <summary className="ops-section-head">Import</summary>
          <form className="form-grid" onSubmit={onUpload}>
            <label>File <input name="file" type="file" /></label>
            <label>Label <input value={sourceLabel} onChange={e => setSourceLabel(e.target.value)} /></label>
            <label>Hint <input value={hint} onChange={e => setHint(e.target.value)} list="ingestor-hints" placeholder="auto" /></label>
            <div className="form-actions"><button type="submit" disabled={busy}>Upload</button></div>
          </form>
          <div className="form-grid" style={{marginTop: 8}}>
            <label className="full">Path <input value={path} onChange={e => setPath(e.target.value)} placeholder="/path/to/output.jsonl" /></label>
            <div className="form-actions"><button type="button" onClick={() => void ingestByPath()} disabled={busy || !path}>Ingest</button></div>
          </div>
        </details>

        <div className="ops-section ops-section-open">
          <div className="ops-section-head">Crawl</div>
          <div className="form-grid">
            <label className="full">Seeds file <input value={crawlSeeds} onChange={e => setCrawlSeeds(e.target.value)} placeholder="/path/to/seeds.urlseed" /></label>
            <label>Label <input value={crawlSource} onChange={e => setCrawlSource(e.target.value)} /></label>
            <label>Depth <input value={maxDepth} onChange={e => setMaxDepth(e.target.value)} /></label>
            <label>Max pages <input value={maxPages} onChange={e => setMaxPages(e.target.value)} /></label>
          </div>
          <label className="ops-skip-crawl">
            <input type="checkbox" checked={audit} onChange={e => setAudit(e.target.checked)} />
            <span>Passive audit (headers, CORS, sensitive paths)</span>
          </label>
          <details>
            <summary style={{cursor: "pointer", fontSize: "0.82rem", padding: "6px 0"}}>Scope hosts</summary>
            <textarea value={scopeHosts} onChange={e => setScopeHosts(e.target.value)} rows={2} placeholder="one host per line (optional)" style={{width: "100%"}} />
          </details>
          <div className="ops-pipeline-actions">
            <button type="button" className="primary" onClick={() => void runCrawl()} disabled={busy || !crawlSeeds}>
              {busy ? "Crawling..." : "Run Crawl"}
            </button>
            {busy && <button type="button" className="danger" onClick={() => abortRef.current?.abort()}>Cancel</button>}
          </div>
          {crawlProgress && (
            <div className="crawl-progress">
              <div className="crawl-progress-bar-bg"><div className="crawl-progress-bar" style={{ width: `${Math.min(100, ((crawlProgress.visited || 0) / (crawlProgress.max_pages || 100)) * 100)}%` }} /></div>
              <div className="crawl-progress-stats">
                <span>{crawlProgress.visited}/{crawlProgress.max_pages} pages</span>
                <span>depth {crawlProgress.depth}/{crawlProgress.max_depth}</span>
                <span>{crawlProgress.nodes} nodes</span>
              </div>
            </div>
          )}
        </div>

        <details className="ops-section">
          <summary className="ops-section-head ops-danger">Danger Zone</summary>
          <button type="button" className="danger" onClick={() => void clearGraph()} disabled={busy} style={{marginTop: 8}}>Clear graph</button>
        </details>
      </div>

      <div className="ops-log">
        <div className="ops-log-header"><span>Activity Log</span><button type="button" className="ghost" onClick={() => setLogs([])}>Clear</button></div>
        <div className="ops-log-body">
          {logs.length === 0 && <div className="ops-log-empty">Run a crawl to see activity here</div>}
          {logs.map((l, i) => (
            <div key={i} className={`ops-log-entry ops-log-${l.level}`}>
              <span className="ops-log-ts">{l.ts}</span><span className="ops-log-phase">{l.phase}</span><span className="ops-log-msg">{l.msg}</span>
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════════
   Fuzz Tab — target, fuzzer, wordlist, filters, TTY terminal
   ═══════════════════════════════════════════════════════════════════ */
function FuzzTab() {
  const [target, setTarget] = useState("");
  const [hosts, setHosts] = useState<string[]>([]);
  const [fuzzer, setFuzzer] = useState<"ffuf" | "feroxbuster">("ffuf");
  const [wordlist, setWordlist] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [ttyLines, setTtyLines] = useState<string[]>([]);
  const ttyRef = useRef<HTMLPreElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    apiJson<{hosts: string[]}>("/api/graph/hosts").then(d => setHosts(d.hosts)).catch(() => {});
  }, []);

  function isProgressLine(s: string) {
    return s.includes(":: Progress:") || (s.startsWith("::") && !s.includes("Method") && !s.includes("URL") && !s.includes("Wordlist"));
  }

  function appendTty(line: string) {
    setTtyLines(prev => {
      const last = prev.length > 0 ? prev[prev.length - 1] : "";
      // TTY behavior: progress lines overwrite previous progress line
      if (isProgressLine(line) && isProgressLine(last)) {
        const next = [...prev];
        next[next.length - 1] = line;
        return next;
      }
      const next = [...prev, line];
      return next.length > 2000 ? next.slice(-1500) : next;
    });
    setTimeout(() => { if (ttyRef.current) ttyRef.current.scrollTop = ttyRef.current.scrollHeight; }, 20);
  }

  async function runFuzz() {
    if (!target) return;
    setBusy(true); setTtyLines([]);
    const extraArgs: string[] = [];
    const mapping = fuzzer === "ffuf"
      ? { fs: "-fs", fw: "-fw", fl: "-fl" } as const
      : { fs: "-S", fw: "-W", fl: "-N" } as const;
    for (const [key, flag] of Object.entries(mapping)) {
      const val = filters[key]?.trim();
      if (val) extraArgs.push(flag, val);
    }

    const reqBody = {
      tool_id: fuzzer,
      targets: [target],
      wordlist: wordlist || null,
      extra_args: extraArgs,
    };

    const ac = new AbortController(); abortRef.current = ac;
    try {
      const r = await apiFetch("/api/tools/run", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody), signal: ac.signal,
      });
      if (!r.ok) throw new Error(await r.text() || r.statusText);
      const reader = r.body?.getReader(); if (!reader) throw new Error("No response body");
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
              appendTty(evt.output);
            } else if (evt.type === "progress" && evt.phase === "starting" && evt.command) {
              appendTty(`$ ${evt.command}`);
            } else if (evt.type === "complete") {
              appendTty("");
              if (evt.ingested) {
                appendTty(`\x1b[32m✓ Ingested: ${evt.ingested.nodes} nodes, ${evt.ingested.edges} edges\x1b[0m`);
              } else if (evt.error) {
                appendTty(`\x1b[31m✗ ${evt.error}\x1b[0m`);
              } else {
                appendTty(`✓ Done (exit ${evt.exit_code ?? "?"}, ${evt.elapsed_seconds ?? "?"}s)`);
              }
            } else if (evt.type === "error") {
              appendTty(`\x1b[31m✗ Error: ${evt.detail}\x1b[0m`);
            }
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") appendTty(`Error: ${err}`);
    } finally { setBusy(false); abortRef.current = null; }
  }

  const filterDefs = fuzzer === "ffuf"
    ? [{ key: "fs", label: "Size", flag: "-fs", ph: "e.g. 11110" }, { key: "fw", label: "Words", flag: "-fw", ph: "e.g. 1328" }, { key: "fl", label: "Lines", flag: "-fl", ph: "e.g. 125" }]
    : [{ key: "fs", label: "Size", flag: "-S", ph: "e.g. 11110" }, { key: "fw", label: "Words", flag: "-W", ph: "e.g. 1328" }, { key: "fl", label: "Lines", flag: "-N", ph: "e.g. 125" }];

  return (
    <div className="ops-fuzz-layout">
      <div className="ops-fuzz-config">
        <div className="ops-fuzz-row">
          <label className="ops-fuzz-field">
            <span className="ops-fuzz-label">Target URL</span>
            <div style={{display: "flex", gap: 4}}>
              <input value={target} onChange={e => setTarget(e.target.value)} placeholder="http://example.com" style={{flex: 1}} />
              {hosts.length > 0 && (
                <select value="" onChange={e => { if (e.target.value) setTarget(e.target.value); }} style={{maxWidth: 140}}>
                  <option value="">From graph...</option>
                  {hosts.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              )}
            </div>
          </label>
        </div>

        <div className="ops-fuzz-row" style={{display: "flex", gap: 12, alignItems: "center"}}>
          <span className="ops-fuzz-label">Fuzzer</span>
          <label style={{display: "flex", alignItems: "center", gap: 4, cursor: "pointer"}}>
            <input type="radio" name="fuzzer" checked={fuzzer === "ffuf"} onChange={() => setFuzzer("ffuf")} /> ffuf
          </label>
          <label style={{display: "flex", alignItems: "center", gap: 4, cursor: "pointer"}}>
            <input type="radio" name="fuzzer" checked={fuzzer === "feroxbuster"} onChange={() => setFuzzer("feroxbuster")} /> Feroxbuster
          </label>
          <div style={{marginLeft: "auto"}}>
            <WordlistPicker current={wordlist} onSelect={setWordlist} />
            <span className="ops-mod-wl-current" style={{marginLeft: 6}}>{wordlist ? wordlist.split("/").pop() : "default"}</span>
          </div>
        </div>

        <div className="ops-fuzz-row" style={{display: "flex", gap: 8, alignItems: "flex-end"}}>
          <span className="ops-fuzz-label" style={{alignSelf: "center"}}>Filters</span>
          {filterDefs.map(f => (
            <label key={f.key} className="ops-filter-field">
              <span className="ops-filter-label">{f.label} ({f.flag})</span>
              <input className="ops-filter-input" placeholder={f.ph}
                value={filters[f.key] || ""}
                onChange={e => setFilters(prev => ({...prev, [f.key]: e.target.value}))} />
            </label>
          ))}
          <div style={{display: "flex", gap: 6, marginLeft: "auto"}}>
            <button type="button" className="primary" onClick={() => void runFuzz()} disabled={busy || !target}>
              {busy ? "Running..." : "Run"}
            </button>
            {busy && <button type="button" className="danger" onClick={() => abortRef.current?.abort()}>Stop</button>}
          </div>
        </div>
      </div>

      <pre className="ops-tty" ref={ttyRef}>
        {ttyLines.length === 0
          ? <span className="ops-tty-empty">Configure a target and run a fuzzer to see output here</span>
          : ttyLines.map((l, i) => <div key={i}>{renderAnsi(l)}</div>)}
      </pre>
    </div>
  );
}

/** Render a TTY line with colors */
function renderAnsi(line: string) {
  const clean = line.replace(/\x1b\[[0-9;]*m/g, "");
  // Our own ANSI markers
  if (line.includes("\x1b[32m")) return <span style={{color: "#4ade80"}}>{clean}</span>;
  if (line.includes("\x1b[31m")) return <span style={{color: "#f87171"}}>{clean}</span>;
  // ffuf match results: highlight status and size
  if (clean.includes("[Status:")) {
    const m = clean.match(/^(.+?)\s+\[Status:\s*(\d+),\s*Size:\s*(\d+),.*$/);
    if (m) {
      const code = parseInt(m[2]);
      const color = code < 300 ? "#4ade80" : code < 400 ? "#facc15" : code < 500 ? "#fb923c" : "#f87171";
      return <><span style={{color: "#67e8f9"}}>{m[1].padEnd(24)}</span> <span style={{color}}>[{m[2]}]</span> <span style={{color: "#94a3b8"}}>{clean.slice(clean.indexOf("Size:"))}</span></>;
    }
  }
  // Progress lines: dim
  if (clean.startsWith("::") && clean.includes("Progress:")) return <span style={{color: "#475569"}}>{clean}</span>;
  // Command line
  if (clean.startsWith("$")) return <span style={{color: "#a78bfa"}}>{clean}</span>;
  // Banner/config: dim
  if (clean.startsWith("::") || clean.startsWith("/") || clean.startsWith("\\") || clean.startsWith("_")) return <span style={{color: "#334155"}}>{clean}</span>;
  return <>{clean}</>;
}


/* ═══════════════════════════════════════════════════════════════════
   Scan Tab — scanner selection, run against graph endpoints
   ═══════════════════════════════════════════════════════════════════ */
function ScanTab() {
  const [enabledWeb, setEnabledWeb] = useState<Set<string>>(new Set(["nuclei"]));
  const [enabledLocal, setEnabledLocal] = useState<Set<string>>(new Set());
  const [localTarget, setLocalTarget] = useState(".");
  const [hosts, setHosts] = useState<string[]>([]);
  const [webTarget, setWebTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const log = useCallback((phase: string, msg: string, level: LogEntry["level"] = "info") => {
    setLogs(prev => [...prev, { ts: ts(), phase, msg, level }]);
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  useEffect(() => {
    apiJson<{hosts: string[]}>("/api/graph/hosts").then(d => setHosts(d.hosts)).catch(() => {});
  }, []);

  function toggle(set: Set<string>, setFn: (s: Set<string>) => void, id: string) {
    const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); setFn(n);
  }

  /** Helper to read SSE events from pipeline endpoint */
  async function streamPipelineScan(reqBody: Record<string, unknown>) {
    const ac = new AbortController(); abortRef.current = ac;
    try {
      const r = await apiFetch("/api/ingest/crawl/stream", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody), signal: ac.signal,
      });
      if (!r.ok) throw new Error(await r.text() || r.statusText);
      const reader = r.body?.getReader(); if (!reader) throw new Error("No body");
      const decoder = new TextDecoder(); let buf = "";
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n"); buf = parts.pop() || "";
        for (const part of parts) {
          const line = part.replace(/^data: /, "").trim(); if (!line) continue;
          try {
            const evt = JSON.parse(line) as any;
            if (evt.type === "crawl_complete") { /* skip */ }
            else if (evt.type === "phase_start") log("scan", `Starting scan (${evt.targets} targets)`);
            else if (evt.type === "phase_complete") log("scan", "Scan phase complete", "success");
            else if (evt.type === "scan_progress") {
              if (evt.phase === "error") log("scan", `✗ ${evt.scanner}: ${evt.detail}`, "error");
              else if (evt.phase === "info") log("scan", `ℹ ${evt.detail}`, "warn");
              else if (evt.phase === "complete" && evt.ingested) log("scan", `✓ ${evt.scanner}: ${evt.ingested.nodes} nodes, ${evt.ingested.edges} edges`, "success");
              else if (evt.phase === "complete") log("scan", `✓ ${evt.scanner}: done`, "info");
              else if (evt.phase === "starting" && evt.detail) log("scan", `▸ ${evt.scanner}: ${evt.detail}`, "info");
              else log("scan", `▸ ${evt.scanner}: ${evt.detail || evt.phase}`, "info");
            } else if (evt.type === "complete") log("scan", "Scan complete", "success");
            else if (evt.type === "error") log("scan", `Error: ${evt.detail}`, "error");
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") log("scan", String(err), "error");
    } finally { abortRef.current = null; }
  }

  async function runWebScan() {
    if (enabledWeb.size === 0) return;
    setBusy(true);
    log("scan", `Starting web scan: ${WEB_SCANNERS.filter(m => enabledWeb.has(m.id)).map(m => m.label).join(", ")}`);
    await streamPipelineScan({
      seeds_file: "", source_label: "scan", crawl_mode: "crawl_only", skip_crawl: true,
      modules: WEB_SCANNERS.map(m => ({ id: m.id, enabled: enabledWeb.has(m.id), wordlist: null, extra_args: [] })),
    });
    setBusy(false);
  }

  /** Fetch web content and scan it locally */
  async function runFetchAndScan() {
    const target = webTarget || (hosts.length > 0 ? hosts[0] : "");
    if (!target || enabledLocal.size === 0) return;
    setBusy(true);
    const ids = LOCAL_SCANNERS.filter(m => enabledLocal.has(m.id)).map(m => m.id);
    log("fetch", `Downloading content from ${target}...`);

    const ac = new AbortController(); abortRef.current = ac;
    try {
      const r = await apiFetch("/api/scan/fetch-and-scan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base_url: target, scanner_ids: ids }), signal: ac.signal,
      });
      if (!r.ok) throw new Error(await r.text() || r.statusText);
      const reader = r.body?.getReader(); if (!reader) throw new Error("No body");
      const decoder = new TextDecoder(); let buf = "";
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n"); buf = parts.pop() || "";
        for (const part of parts) {
          const line = part.replace(/^data: /, "").trim(); if (!line) continue;
          try {
            const evt = JSON.parse(line) as any;
            if (evt.type === "status") log("fetch", evt.detail);
            else if (evt.type === "scanner_start") log("scan", `▸ ${evt.scanner}: starting...`);
            else if (evt.type === "scanner_progress") {
              if (evt.output) log("scan", `  ${evt.scanner}: ${evt.output}`);
            }
            else if (evt.type === "scanner_done") {
              if (evt.ingested) log("scan", `✓ ${evt.scanner}: ${evt.ingested.nodes} nodes, ${evt.ingested.edges} edges`, "success");
              else if (evt.error) log("scan", `✗ ${evt.scanner}: ${evt.error}`, "error");
              else log("scan", `✓ ${evt.scanner}: done (exit ${evt.exit_code ?? "?"})`, "info");
            }
            else if (evt.type === "complete") {
              if (evt.ok) log("fetch", `Scan complete (${evt.files} files scanned)`, "success");
              else log("fetch", `Failed: ${evt.error}`, "error");
            }
            else if (evt.type === "error") log("scan", `Error: ${evt.detail}`, "error");
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") log("scan", String(err), "error");
    } finally { setBusy(false); abortRef.current = null; }
  }

  /** Run local scanners against a local filesystem path */
  async function runLocalScan() {
    if (enabledLocal.size === 0 || !localTarget) return;
    setBusy(true);
    log("scan", `Scanning local path: ${localTarget}`);
    for (const m of LOCAL_SCANNERS) {
      if (!enabledLocal.has(m.id)) continue;
      log("scan", `▸ ${m.label}: starting...`);
      try {
        const r = await apiFetch("/api/tools/run", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tool_id: m.id, targets: [localTarget], extra_args: [] }),
        });
        if (!r.ok) throw new Error(await r.text() || r.statusText);
        const reader = r.body?.getReader(); if (!reader) continue;
        const decoder = new TextDecoder(); let buf = "";
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split("\n\n"); buf = parts.pop() || "";
          for (const part of parts) {
            const line = part.replace(/^data: /, "").trim(); if (!line) continue;
            try {
              const evt = JSON.parse(line) as any;
              if (evt.type === "complete") {
                if (evt.ingested) log("scan", `✓ ${m.label}: ${evt.ingested.nodes} nodes, ${evt.ingested.edges} edges`, "success");
                else if (evt.error) log("scan", `✗ ${m.label}: ${evt.error}`, "error");
                else log("scan", `✓ ${m.label}: done (exit ${evt.exit_code ?? "?"})`, "info");
              } else if (evt.type === "error") log("scan", `✗ ${m.label}: ${evt.detail}`, "error");
            } catch { /* skip */ }
          }
        }
      } catch (err) { log("scan", `✗ ${m.label}: ${err}`, "error"); }
    }
    setBusy(false);
  }

  return (
    <div className="ops-crawl-layout">
      <div className="ops-config">
        <div className="ops-section ops-section-open">
          <div className="ops-section-head">Web Scanners</div>
          <p style={{fontSize: "0.78rem", color: "var(--c-text-muted,#888)", margin: "4px 0 8px"}}>
            Scan URLs from the graph (crawl/fuzz results).
          </p>
          {WEB_SCANNERS.map(m => (
            <label key={m.id} className="ops-mod-item" style={{display: "flex", gap: 6, padding: "4px 0"}}>
              <input type="checkbox" checked={enabledWeb.has(m.id)} onChange={() => toggle(enabledWeb, setEnabledWeb, m.id)} />
              <span className="ops-mod-name">{m.label}</span>
              <span className="ops-mod-desc">{m.desc}</span>
            </label>
          ))}
          <div className="ops-pipeline-actions" style={{marginTop: 8}}>
            <button type="button" className="primary" onClick={() => void runWebScan()} disabled={busy || enabledWeb.size === 0}>
              {busy ? "Scanning..." : "Run Web Scan"}
            </button>
            {busy && <button type="button" className="danger" onClick={() => abortRef.current?.abort()}>Cancel</button>}
          </div>
        </div>

        <div className="ops-section ops-section-open">
          <div className="ops-section-head">Code &amp; Dependency Scanners</div>
          <p style={{fontSize: "0.78rem", color: "var(--c-text-muted,#888)", margin: "4px 0 8px"}}>
            Download discovered web content and scan for secrets, vulnerabilities, and code issues.
          </p>
          {LOCAL_SCANNERS.map(m => (
            <label key={m.id} className="ops-mod-item" style={{display: "flex", gap: 6, padding: "4px 0"}}>
              <input type="checkbox" checked={enabledLocal.has(m.id)} onChange={() => toggle(enabledLocal, setEnabledLocal, m.id)} />
              <span className="ops-mod-name">{m.label}</span>
              <span className="ops-mod-desc">{m.desc}</span>
            </label>
          ))}
          <div style={{marginTop: 8, fontSize: "0.78rem", fontWeight: 600, color: "var(--c-text-muted,#888)"}}>Target</div>
          <div style={{display: "flex", gap: 6, marginTop: 4}}>
            <div style={{display: "flex", gap: 4, flex: 1}}>
              <input value={webTarget} onChange={e => setWebTarget(e.target.value)}
                placeholder="http://target or /local/path" style={{flex: 1}} />
              {hosts.length > 0 && (
                <select value="" onChange={e => { if (e.target.value) setWebTarget(e.target.value); }} style={{maxWidth: 140}}>
                  <option value="">From graph...</option>
                  {hosts.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              )}
            </div>
          </div>
          <div className="ops-pipeline-actions" style={{marginTop: 8}}>
            {(webTarget.startsWith("http://") || webTarget.startsWith("https://")) ? (
              <button type="button" className="primary" onClick={() => void runFetchAndScan()} disabled={busy || enabledLocal.size === 0 || !webTarget}>
                {busy ? "Fetching & Scanning..." : "Fetch & Scan"}
              </button>
            ) : (
              <button type="button" className="primary" onClick={() => { setLocalTarget(webTarget || "."); void runLocalScan(); }}
                disabled={busy || enabledLocal.size === 0 || !webTarget}>
                {busy ? "Scanning..." : "Scan Local Path"}
              </button>
            )}
            {busy && <button type="button" className="danger" onClick={() => abortRef.current?.abort()}>Cancel</button>}
          </div>
        </div>
      </div>

      <div className="ops-log">
        <div className="ops-log-header"><span>Scan Log</span><button type="button" className="ghost" onClick={() => setLogs([])}>Clear</button></div>
        <div className="ops-log-body">
          {logs.length === 0 && <div className="ops-log-empty">Run scanners to see results here</div>}
          {logs.map((l, i) => (
            <div key={i} className={`ops-log-entry ops-log-${l.level}`}>
              <span className="ops-log-ts">{l.ts}</span><span className="ops-log-phase">{l.phase}</span><span className="ops-log-msg">{l.msg}</span>
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════════
   Shared: WordlistPicker modal
   ═══════════════════════════════════════════════════════════════════ */
function WordlistPicker({ current, onSelect }: { current: string; onSelect: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const [wordlists, setWordlists] = useState<Wordlist[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");

  useEffect(() => {
    if (!open) return;
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (search) params.set("search", search);
    params.set("limit", "100");
    apiJson<{wordlists: Wordlist[]}>(`/api/wordlists?${params}`)
      .then(d => setWordlists(d.wordlists)).catch(() => setWordlists([]));
  }, [open, search, category]);

  const categories = [...new Set(wordlists.map(w => w.category))].sort();

  return (
    <>
      <button type="button" className="ghost ops-wl-change-btn" onClick={() => setOpen(true)}>Change wordlist</button>
      {open && (
        <div className="wl-picker-overlay" onClick={() => setOpen(false)}>
          <div className="wl-picker" onClick={e => e.stopPropagation()}>
            <div className="wl-picker-header"><h3>Select Wordlist</h3><button type="button" className="ghost" onClick={() => setOpen(false)}>✕</button></div>
            <div className="wl-picker-filters">
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search wordlists..." autoFocus className="wl-picker-search" />
              <select value={category} onChange={e => setCategory(e.target.value)} className="wl-picker-cat">
                <option value="">All categories</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="wl-picker-list">
              {wordlists.map(w => (
                <button key={w.path} type="button"
                  className={`wl-picker-item ${w.path === current ? "wl-picker-active" : ""}`}
                  onClick={() => { onSelect(w.path); setOpen(false); }}>
                  <span className="wl-picker-name">{w.name}</span>
                  <span className="wl-picker-meta"><span className="badge">{w.category}</span><span>{w.lines.toLocaleString()} lines</span></span>
                  <span className="wl-picker-path">{w.relative}</span>
                </button>
              ))}
              {wordlists.length === 0 && <div className="wl-picker-empty">No wordlists found.</div>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
