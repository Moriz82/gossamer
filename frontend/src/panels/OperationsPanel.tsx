import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, apiJson } from "../api";

type LogEntry = { ts: string; phase: string; msg: string; level: "info" | "warn" | "error" | "success" };
type CrawlProgress = {
  type: string; visited?: number; queue_size?: number; max_pages?: number;
  depth?: number; max_depth?: number; current_url?: string;
  nodes?: number; edges?: number; detail?: string; scanner?: string; phase?: string;
};

type PresetInfo = { name: string; description: string; audit: boolean; scanner_summary: string };

const PIPELINE_MODULES = [
  { id: "crawl_audit", label: "Passive Audit", desc: "HTTP status, CORS, redirects, sensitive paths", phase: "crawl" },
  { id: "nuclei", label: "Nuclei", desc: "Template-based vulnerability scanner", phase: "scan" },
  { id: "ffuf", label: "ffuf", desc: "Directory/file fuzzing", phase: "fuzz" },
  { id: "feroxbuster", label: "Feroxbuster", desc: "Recursive content discovery", phase: "fuzz" },
  { id: "trivy", label: "Trivy", desc: "Container/filesystem vulnerability scanner", phase: "scan" },
  { id: "gitleaks", label: "Gitleaks", desc: "Secret scanning", phase: "scan" },
  { id: "grype", label: "Grype", desc: "SCA vulnerability scanner", phase: "scan" },
  { id: "semgrep", label: "Semgrep", desc: "Static analysis", phase: "scan" },
];

function ts() { return new Date().toLocaleTimeString(); }

export default function OperationsPanel() {
  const [ingestorNames, setIngestorNames] = useState<string[]>([]);
  const [path, setPath] = useState("");
  const [sourceLabel, setSourceLabel] = useState("import");
  const [hint, setHint] = useState("");
  const [crawlSeeds, setCrawlSeeds] = useState("");
  const [crawlSource, setCrawlSource] = useState("crawl");
  const [maxDepth, setMaxDepth] = useState("3");
  const [maxPages, setMaxPages] = useState("100");
  const [scopeHosts, setScopeHosts] = useState("");
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [presets, setPresets] = useState<PresetInfo[] | null>(null);
  const [enabledModules, setEnabledModules] = useState<Set<string>>(new Set(["crawl_audit"]));
  const [busy, setBusy] = useState(false);
  const [crawlProgress, setCrawlProgress] = useState<CrawlProgress | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const log = useCallback((phase: string, msg: string, level: LogEntry["level"] = "info") => {
    setLogs(prev => [...prev, { ts: ts(), phase, msg, level }]);
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  useEffect(() => {
    apiJson<{ name: string }[]>("/api/ingestors").then(r => setIngestorNames(r.map(x => x.name))).catch(() => {});
    apiJson<PresetInfo[]>("/api/scan-presets").then(setPresets).catch(() => {});
  }, []);

  // When preset changes, update enabled modules
  useEffect(() => {
    if (!selectedPreset) {
      setEnabledModules(new Set());
      return;
    }
    const mods = new Set<string>();
    if (selectedPreset === "light") { mods.add("crawl_audit"); }
    else if (selectedPreset === "medium") { mods.add("crawl_audit"); mods.add("nuclei"); }
    else if (selectedPreset === "full") { PIPELINE_MODULES.forEach(m => mods.add(m.id)); }
    setEnabledModules(mods);
  }, [selectedPreset]);

  function toggleModule(id: string) {
    setEnabledModules(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      setSelectedPreset(null); // custom selection
      return next;
    });
  }

  async function onUpload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = (e.currentTarget.elements.namedItem("file") as HTMLInputElement);
    const file = input.files?.[0];
    if (!file) return;
    setBusy(true);
    log("ingest", `Uploading ${file.name}...`);
    const fd = new FormData(); fd.append("file", file);
    const q = new URLSearchParams({ source_label: sourceLabel });
    if (hint) q.set("ingestor_hint", hint);
    try {
      const r = await apiFetch(`/api/ingest?${q}`, { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || JSON.stringify(j));
      log("ingest", `Ingested: ${j.nodes} nodes, ${j.edges} edges`, "success");
      input.value = "";
    } catch (err) { log("ingest", String(err), "error"); }
    finally { setBusy(false); }
  }

  async function ingestByPath() {
    setBusy(true); log("ingest", `Ingesting ${path}...`);
    try {
      const j = await apiJson<any>("/api/ingest/path", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, source_label: sourceLabel, ingestor_hint: hint || null }),
      });
      log("ingest", `Done: ${j.nodes} nodes, ${j.edges} edges`, "success");
    } catch (err) { log("ingest", String(err), "error"); }
    finally { setBusy(false); }
  }

  async function runPipeline() {
    if (!crawlSeeds) return;
    setBusy(true); setCrawlProgress(null);
    log("crawl", `Starting crawl of ${crawlSeeds}`);

    const hasAudit = enabledModules.has("crawl_audit");
    const reqBody: Record<string, unknown> = {
      seeds_file: crawlSeeds, source_label: crawlSource,
      crawl_mode: hasAudit ? "crawl_audit" : "crawl_only",
      scan_preset: selectedPreset || undefined,
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
      const reader = r.body?.getReader();
      if (!reader) throw new Error("No response body");
      const decoder = new TextDecoder(); let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n"); buf = parts.pop() || "";
        for (const part of parts) {
          const line = part.replace(/^data: /, "").trim();
          if (!line) continue;
          try {
            const evt = JSON.parse(line) as CrawlProgress;
            if (evt.type === "progress") {
              setCrawlProgress(evt);
              if (evt.current_url) log("crawl", `[${evt.visited}/${evt.max_pages}] ${evt.current_url}`);
            } else if (evt.type === "crawl_complete") {
              setCrawlProgress(null);
              log("crawl", `Crawl complete: ${evt.nodes} nodes, ${evt.edges} edges`, "success");
            } else if (evt.type === "scan_progress") {
              log("scan", `${evt.scanner}: ${evt.phase}`, evt.phase === "error" ? "error" : "info");
            } else if (evt.type === "complete") {
              setCrawlProgress(null);
              log("pipeline", `Pipeline complete: ${evt.nodes} nodes, ${evt.edges} edges`, "success");
            } else if (evt.type === "error") {
              setCrawlProgress(null);
              log("pipeline", `Error: ${evt.detail}`, "error");
            }
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") log("pipeline", String(err), "error");
      setCrawlProgress(null);
    } finally { setBusy(false); abortRef.current = null; }
  }

  async function clearGraph() {
    if (!confirm("Clear all nodes and edges?")) return;
    setBusy(true); log("system", "Clearing graph...");
    try { await apiJson("/api/graph", { method: "DELETE" }); log("system", "Graph cleared", "success"); }
    catch (err) { log("system", String(err), "error"); }
    finally { setBusy(false); }
  }

  return (
    <div className="ops-layout">
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
          <div className="ops-section-head">Pipeline: Crawl → Fuzz → Scan</div>
          <div className="form-grid">
            <label className="full">Seeds file <input value={crawlSeeds} onChange={e => setCrawlSeeds(e.target.value)} placeholder="/path/to/seeds.urlseed" /></label>
            <label>Label <input value={crawlSource} onChange={e => setCrawlSource(e.target.value)} /></label>
            <label>Depth <input value={maxDepth} onChange={e => setMaxDepth(e.target.value)} /></label>
            <label>Max pages <input value={maxPages} onChange={e => setMaxPages(e.target.value)} /></label>
          </div>

          <div className="ops-presets">
            <div className="ops-presets-header">
              <span className="ops-label">Preset</span>
              <div className="ops-preset-pills">
                <button type="button" className={`pill ${!selectedPreset ? "pill-active" : ""}`} onClick={() => setSelectedPreset(null)}>None</button>
                {presets?.map(p => (
                  <button key={p.name} type="button" className={`pill ${selectedPreset === p.name ? "pill-active" : ""}`} onClick={() => setSelectedPreset(p.name)}>{p.name}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="ops-modules">
            <div className="ops-label">Pipeline Modules</div>
            <div className="ops-mod-groups">
              {(["crawl", "fuzz", "scan"] as const).map(phase => (
                <div key={phase} className="ops-mod-group">
                  <div className="ops-mod-phase">{phase}</div>
                  {PIPELINE_MODULES.filter(m => m.phase === phase).map(m => (
                    <label key={m.id} className="ops-mod-item">
                      <input type="checkbox" checked={enabledModules.has(m.id)} onChange={() => toggleModule(m.id)} />
                      <span className="ops-mod-name">{m.label}</span>
                      <span className="ops-mod-desc">{m.desc}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <details>
            <summary style={{cursor: "pointer", fontSize: "0.82rem", padding: "6px 0"}}>Scope hosts</summary>
            <textarea value={scopeHosts} onChange={e => setScopeHosts(e.target.value)} rows={2} placeholder="one host per line (optional)" style={{width: "100%"}} />
          </details>

          <div className="ops-pipeline-actions">
            <button type="button" className="primary" onClick={() => void runPipeline()} disabled={busy || !crawlSeeds}>
              {busy ? "Running..." : "Run Pipeline"}
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

        <FuzzingCard log={log} />

        <details className="ops-section">
          <summary className="ops-section-head ops-danger">Danger Zone</summary>
          <button type="button" className="danger" onClick={() => void clearGraph()} disabled={busy} style={{marginTop: 8}}>Clear graph</button>
        </details>
      </div>

      <div className="ops-resize-handle" onMouseDown={(e) => {
        e.preventDefault();
        const logEl = e.currentTarget.nextElementSibling as HTMLElement;
        if (!logEl) return;
        const startX = e.clientX;
        const startW = logEl.offsetWidth;
        const onMove = (ev: MouseEvent) => { logEl.style.width = `${Math.max(200, startW - (ev.clientX - startX))}px`; };
        const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      }} />
      <div className="ops-log">
        <div className="ops-log-header">
          <span>Activity Log</span>
          <button type="button" className="ghost" onClick={() => setLogs([])}>Clear</button>
        </div>
        <div className="ops-log-body">
          {logs.length === 0 && <div className="ops-log-empty">Run a pipeline to see activity here</div>}
          {logs.map((l, i) => (
            <div key={i} className={`ops-log-entry ops-log-${l.level}`}>
              <span className="ops-log-ts">{l.ts}</span>
              <span className="ops-log-phase">{l.phase}</span>
              <span className="ops-log-msg">{l.msg}</span>
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  );
}

type WordlistDir = { path: string; exists: boolean };
type Wordlist = { path: string; name: string; relative: string; category: string; lines: number; size_bytes: number };

function FuzzingCard({ log }: { log: (phase: string, msg: string, level?: "info" | "warn" | "error" | "success") => void }) {
  const [dirs, setDirs] = useState<WordlistDir[]>([]);
  const [wordlists, setWordlists] = useState<Wordlist[]>([]);
  const [wlCategory, setWlCategory] = useState("");
  const [wlSearch, setWlSearch] = useState("");
  const [newDir, setNewDir] = useState("");
  const [busy, setBusy] = useState(false);
  const [showWordlists, setShowWordlists] = useState(false);

  const loadDirs = useCallback(() => {
    apiJson<{dirs: WordlistDir[]}>("/api/wordlists/dirs").then(d => setDirs(d.dirs)).catch(() => {});
  }, []);
  useEffect(() => { loadDirs(); }, [loadDirs]);

  const loadWordlists = useCallback(() => {
    const params = new URLSearchParams();
    if (wlCategory) params.set("category", wlCategory);
    if (wlSearch) params.set("search", wlSearch);
    apiJson<{wordlists: Wordlist[]}>(`/api/wordlists?${params}`).then(d => setWordlists(d.wordlists)).catch(() => setWordlists([]));
  }, [wlCategory, wlSearch]);
  useEffect(() => { if (showWordlists) loadWordlists(); }, [showWordlists, loadWordlists]);

  async function installSecLists() {
    setBusy(true); log("wordlists", "Installing SecLists...");
    try {
      const r = await apiJson<{ok: boolean; path?: string; error?: string; message?: string}>("/api/wordlists/install-seclists", { method: "POST" });
      log("wordlists", r.ok ? `SecLists installed at ${r.path || r.message}` : `Error: ${r.error}`, r.ok ? "success" : "error");
      loadDirs();
    } catch (e) { log("wordlists", String(e), "error"); }
    finally { setBusy(false); }
  }

  async function addDir() {
    if (!newDir.trim()) return;
    await apiJson<any>("/api/wordlists/dirs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: newDir }) });
    setNewDir(""); loadDirs();
  }

  async function removeDir(p: string) {
    await apiFetch("/api/wordlists/dirs", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: p }) });
    loadDirs();
  }

  const categories = [...new Set(wordlists.map(w => w.category))].sort();

  return (
    <details className="ops-section">
      <summary className="ops-section-head">Wordlists &amp; Fuzzing</summary>
      <div style={{display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap"}}>
        <button type="button" className="primary" onClick={() => void installSecLists()} disabled={busy}>{busy ? "Installing..." : "Install SecLists"}</button>
        <button type="button" onClick={() => setShowWordlists(!showWordlists)}>{showWordlists ? "Hide" : "Browse"} wordlists</button>
      </div>
      <details>
        <summary style={{cursor: "pointer", fontSize: "0.82rem"}}>Directories ({dirs.filter(d => d.exists).length} found)</summary>
        <div style={{marginTop: 6}}>
          {dirs.map(d => (
            <div key={d.path} style={{display: "flex", alignItems: "center", gap: 6, padding: "2px 0", fontSize: "0.78rem"}}>
              <span className={`status-dot ${d.exists ? "green" : "gray"}`} />
              <code style={{flex: 1}}>{d.path}</code>
              <button type="button" className="ghost" onClick={() => void removeDir(d.path)} style={{fontSize: "0.72rem"}}>✕</button>
            </div>
          ))}
          <div style={{display: "flex", gap: 6, marginTop: 4}}>
            <input value={newDir} onChange={e => setNewDir(e.target.value)} placeholder="/path/to/wordlists" style={{flex: 1}} onKeyDown={e => { if (e.key === "Enter") void addDir(); }} />
            <button type="button" onClick={() => void addDir()} disabled={!newDir.trim()}>Add</button>
          </div>
        </div>
      </details>
      {showWordlists && (
        <div style={{marginTop: 8}}>
          <div style={{display: "flex", gap: 6, marginBottom: 6}}>
            <select value={wlCategory} onChange={e => setWlCategory(e.target.value)} style={{minWidth: 100}}>
              <option value="">All</option>{categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input value={wlSearch} onChange={e => setWlSearch(e.target.value)} placeholder="Search..." style={{flex: 1}} />
          </div>
          <div style={{maxHeight: 220, overflowY: "auto", border: "1px solid var(--c-border,#333)", borderRadius: 4}}>
            <table className="findings-table" style={{fontSize: "0.75rem"}}>
              <thead><tr><th>Name</th><th>Cat</th><th style={{textAlign: "right"}}>Lines</th></tr></thead>
              <tbody>
                {wordlists.map(w => <tr key={w.path}><td style={{fontWeight: 500}}>{w.name}</td><td><span className="badge">{w.category}</span></td><td style={{textAlign: "right"}}>{w.lines.toLocaleString()}</td></tr>)}
                {!wordlists.length && <tr><td colSpan={3} className="muted" style={{textAlign: "center", padding: 12}}>No wordlists found</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </details>
  );
}
