import {
  ChangeEvent,
  DragEvent,
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { apiFetch, apiJson } from "../api";
import "../styles/screens.css";

/* ========================================================================
   Types
   ======================================================================== */
type RunKind = "crawl" | "audit" | "fuzz" | "scan" | "import";
type OpsTab = "crawl" | "fuzz" | "scan" | "import";
type RunStatus = "idle" | "running" | "paused" | "done" | "error";
type LogLevel = "info" | "warn" | "error" | "success";

type LogEntry = {
  id: number;
  ts: string;
  phase: string;
  msg: string;
  level: LogLevel;
  run: RunKind;
};

type RunState = {
  id: RunKind;
  title: string;
  status: RunStatus;
  visited: number;
  total: number;
  pct: number;
  meta: Array<[string | number, string]>;
};

type Plugin = {
  id: string;
  type?: string;
  name: string;
  description?: string;
  installed?: boolean;
  binary?: string | null;
};

type ScanPreset = {
  name: string;
  description: string;
  audit?: boolean;
  scanner_summary?: string;
};

type Wordlist = {
  path: string;
  name: string;
  relative: string;
  category: string;
  lines: number;
  size_bytes: number;
};

type GraphStats = { total_nodes: number; total_edges: number };

const RUN_KINDS: RunKind[] = ["crawl", "audit", "fuzz", "scan", "import"];

const FALLBACK_SCANNERS: Plugin[] = [
  { id: "nuclei", name: "Nuclei", description: "Template-based vuln scanner", type: "web" },
  { id: "trivy", name: "Trivy", description: "Container/FS scan", type: "local" },
  { id: "gitleaks", name: "Gitleaks", description: "Secret leaks", type: "local" },
  { id: "semgrep", name: "Semgrep", description: "SAST", type: "local" },
  { id: "grype", name: "Grype", description: "SCA vuln scanner", type: "local" },
];

const SEVERITIES = ["info", "low", "med", "high", "crit"] as const;

/* ========================================================================
   Inline icons (stroked 24x24, follows currentColor)
   ======================================================================== */
type IconProps = { size?: number };
const svg = (p: IconProps, children: ReactNode) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    width={p.size ?? 14}
    height={p.size ?? 14}
  >
    {children}
  </svg>
);
const Icon = {
  threads: (p: IconProps = {}) => svg(p, <>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v6M12 15v6M3 12h6M15 12h6M5.6 5.6l4.2 4.2M14.2 14.2l4.2 4.2M5.6 18.4l4.2-4.2M14.2 9.8l4.2-4.2" />
  </>),
  target: (p: IconProps = {}) => svg(p, <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
  </>),
  scan: (p: IconProps = {}) => svg(p, <>
    <path d="M4 4h4M20 4h-4M4 20h4M20 20h-4M4 4v4M20 4v4M4 20v-4M20 20v-4" />
    <circle cx="12" cy="12" r="4" />
    <path d="M12 8v8" />
  </>),
  upload: (p: IconProps = {}) => svg(p, <>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
  </>),
  play: (p: IconProps = {}) => svg(p, <path d="M6 4l14 8-14 8V4z" fill="currentColor" />),
  pause: (p: IconProps = {}) => svg(p, <>
    <rect x="6" y="5" width="4" height="14" fill="currentColor" />
    <rect x="14" y="5" width="4" height="14" fill="currentColor" />
  </>),
  stop: (p: IconProps = {}) => svg(p, <rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" />),
  save: (p: IconProps = {}) => svg(p, <>
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <path d="M17 21v-8H7v8M7 3v5h8" />
  </>),
  close: (p: IconProps = {}) => svg(p, <path d="M6 6l12 12M18 6L6 18" />),
  terminal: (p: IconProps = {}) => svg(p, <>
    <path d="m5 8 4 4-4 4M11 16h8" />
    <rect x="2" y="4" width="20" height="16" rx="2" />
  </>),
};

/* ========================================================================
   Helpers
   ======================================================================== */
function nowTs(): string {
  return new Date().toLocaleTimeString();
}

async function readSse(
  response: Response,
  onEvent: (evt: Record<string, unknown>) => void,
  signal?: AbortSignal,
) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    if (signal?.aborted) return;
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() || "";
    for (const part of parts) {
      const line = part.replace(/^data: /, "").trim();
      if (!line) continue;
      try {
        onEvent(JSON.parse(line));
      } catch {
        /* ignore malformed */
      }
    }
  }
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function ansiLevel(s: string): LogLevel {
  // eslint-disable-next-line no-control-regex
  if (s.includes("\x1b[32m")) return "success";
  // eslint-disable-next-line no-control-regex
  if (s.includes("\x1b[31m")) return "error";
  // eslint-disable-next-line no-control-regex
  if (s.includes("\x1b[33m")) return "warn";
  return "info";
}

/* ========================================================================
   Main panel
   ======================================================================== */
export default function OperationsPanel() {
  const [tab, setTab] = useState<OpsTab>("crawl");
  const [selectedRun, setSelectedRun] = useState<RunKind | "all">("all");
  const [termOpen, setTermOpen] = useState(true);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logIdRef = useRef(0);
  const logEndRef = useRef<HTMLDivElement>(null);

  const appendLog = useCallback(
    (run: RunKind, phase: string, msg: string, level: LogLevel = "info") => {
      const id = ++logIdRef.current;
      setLogs((prev) => {
        const next = prev.concat({ id, ts: nowTs(), phase, msg, level, run });
        return next.length > 2000 ? next.slice(-1500) : next;
      });
      setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: "smooth" }), 20);
    },
    [],
  );

  const clearLogs = useCallback(() => setLogs([]), []);

  // Run states (one per run kind)
  const [runs, setRuns] = useState<Record<RunKind, RunState>>(() => ({
    crawl: { id: "crawl", title: "Crawl", status: "idle", visited: 0, total: 0, pct: 0, meta: [] },
    audit: { id: "audit", title: "Audit", status: "idle", visited: 0, total: 0, pct: 0, meta: [] },
    fuzz: { id: "fuzz", title: "Fuzz", status: "idle", visited: 0, total: 0, pct: 0, meta: [] },
    scan: { id: "scan", title: "Scan", status: "idle", visited: 0, total: 0, pct: 0, meta: [] },
    import: { id: "import", title: "Import", status: "idle", visited: 0, total: 0, pct: 0, meta: [] },
  }));
  const updateRun = useCallback((id: RunKind, patch: Partial<RunState>) => {
    setRuns((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  // Graph stats (polled while any run is active)
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [statsBaseline, setStatsBaseline] = useState<GraphStats | null>(null);
  const [findingsCount, setFindingsCount] = useState<number>(0);
  const [requestsCount, setRequestsCount] = useState<number>(0);

  const anyRunning = Object.values(runs).some((r) => r.status === "running");

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      apiJson<GraphStats>("/api/graph/stats")
        .then((s) => {
          if (cancelled) return;
          setStats(s);
          setStatsBaseline((prev) => prev ?? s);
        })
        .catch(() => {});
      apiJson<{ findings: unknown[] }>("/api/findings")
        .then((f) => {
          if (cancelled) return;
          setFindingsCount(Array.isArray(f.findings) ? f.findings.length : 0);
        })
        .catch(() => {});
    };
    poll();
    if (!anyRunning) return () => { cancelled = true; };
    const i = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(i);
    };
  }, [anyRunning]);

  // Seed a baseline when any run starts
  const prevRunningRef = useRef(false);
  useEffect(() => {
    if (anyRunning && !prevRunningRef.current) {
      setStatsBaseline(stats);
      setRequestsCount(0);
    }
    prevRunningRef.current = anyRunning;
  }, [anyRunning, stats]);

  const runList = useMemo(
    () => RUN_KINDS.map((k) => runs[k]).filter((r) => r.status !== "idle"),
    [runs],
  );

  const filteredLogs = useMemo(
    () => (selectedRun === "all" ? logs : logs.filter((l) => l.run === selectedRun)),
    [logs, selectedRun],
  );

  const sessionNodesDelta =
    stats && statsBaseline ? Math.max(0, stats.total_nodes - statsBaseline.total_nodes) : 0;
  const sessionEdgesDelta =
    stats && statsBaseline ? Math.max(0, stats.total_edges - statsBaseline.total_edges) : 0;

  return (
    <div className={`ops ${!termOpen ? "term-hidden" : ""}`}>
      <div className="ops-top">
        <div className="ops-panel">
          <div className="ops-tabs">
            {([
              ["crawl", "Crawl", <Icon.threads size={13} key="i" />],
              ["fuzz", "Fuzz", <Icon.target size={13} key="i" />],
              ["scan", "Scan", <Icon.scan size={13} key="i" />],
              ["import", "Import", <Icon.upload size={13} key="i" />],
            ] as Array<[OpsTab, string, ReactNode]>).map(([id, label, icon]) => (
              <button
                key={id}
                type="button"
                className={`ops-tab ${tab === id ? "on" : ""}`}
                onClick={() => setTab(id)}
              >
                {icon} {label}
              </button>
            ))}
          </div>

          {tab === "crawl" && (
            <CrawlTab
              appendLog={appendLog}
              updateRun={updateRun}
              setRequests={setRequestsCount}
            />
          )}
          {tab === "fuzz" && (
            <FuzzTab
              appendLog={appendLog}
              updateRun={updateRun}
              setRequests={setRequestsCount}
            />
          )}
          {tab === "scan" && (
            <ScanTab
              appendLog={appendLog}
              updateRun={updateRun}
            />
          )}
          {tab === "import" && (
            <ImportTab appendLog={appendLog} updateRun={updateRun} />
          )}
        </div>

        {/* Right: live runs + session counters */}
        <div className="ops-panel right">
          <div className="right-head">Live runs</div>
          <div className="progress-stack">
            {runList.length === 0 ? (
              <div style={{
                padding: "16px",
                color: "var(--fg-3)",
                fontSize: "var(--fs-xs)",
                textAlign: "center",
                border: "1px dashed var(--line-0)",
                borderRadius: "var(--r-md)",
              }}>
                No active runs. Start a crawl, fuzz, scan, or import to see progress here.
              </div>
            ) : runList.map((r) => (
              <div
                key={r.id}
                className={`progress-card ${selectedRun === r.id ? "sel" : ""} ${r.status === "paused" ? "paused" : ""}`}
                onClick={() => setSelectedRun(r.id)}
              >
                <div className="progress-head">
                  <span className="pg-title">
                    {r.status === "paused" ? (
                      <Icon.pause size={11} />
                    ) : r.status === "running" ? (
                      <span className="pulse" />
                    ) : (
                      <span className="pulse" style={{ background: "var(--fg-3)", animation: "none" }} />
                    )}
                    {r.title}
                    {r.status !== "running" && (
                      <span style={{
                        color: "var(--fg-3)",
                        marginLeft: 4,
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                      }}>{r.status}</span>
                    )}
                  </span>
                  <span className="pg-pct">{Math.round(r.pct)}%</span>
                </div>
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${Math.min(100, r.pct)}%`,
                      background: r.status === "paused" || r.status === "error" ? "var(--fg-3)" : undefined,
                    }}
                  />
                </div>
                <div className="progress-meta">
                  {r.meta.map(([v, l], i) => (
                    <span key={i}><strong>{typeof v === "number" ? v.toLocaleString() : v}</strong>{l}</span>
                  ))}
                </div>
                <div className="progress-viewlog">
                  {selectedRun === r.id ? "▸ showing in console" : "click to view in console →"}
                </div>
              </div>
            ))}
          </div>

          <div className="session-head">This session</div>
          <div className="session-grid">
            <div className="session-cell">
              <div className="cell-label">Nodes added</div>
              <div className="cell-value">{sessionNodesDelta.toLocaleString()}</div>
            </div>
            <div className="session-cell">
              <div className="cell-label">Edges added</div>
              <div className="cell-value">{sessionEdgesDelta.toLocaleString()}</div>
            </div>
            <div className="session-cell">
              <div className="cell-label">Findings</div>
              <div className="cell-value">{findingsCount.toLocaleString()}</div>
            </div>
            <div className="session-cell">
              <div className="cell-label">Requests</div>
              <div className="cell-value">{requestsCount.toLocaleString()}</div>
            </div>
          </div>
        </div>
      </div>

      {termOpen ? (
        <div className="log">
          <div className="log-head">
            <span className="dot" />
            <span>Console</span>
            <span style={{ color: "var(--fg-3)" }}>·</span>
            <span className="mono" style={{ color: "var(--silk)" }}>
              {selectedRun === "all" ? "all runs" : runs[selectedRun as RunKind]?.title || selectedRun}
            </span>
            <span style={{ color: "var(--fg-3)" }}>·</span>
            <span>{filteredLogs.length} events</span>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              className={`btn ghost ${selectedRun === "all" ? "on" : ""}`}
              style={{ fontSize: 10 }}
              onClick={() => setSelectedRun("all")}
            >ALL</button>
            {(["crawl", "audit", "fuzz"] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={`btn ghost ${selectedRun === k ? "on" : ""}`}
                style={{ fontSize: 10 }}
                onClick={() => setSelectedRun(k)}
              >{k.toUpperCase()}</button>
            ))}
            <button
              type="button"
              className="btn ghost"
              style={{ fontSize: 10 }}
              onClick={clearLogs}
              title="Clear log"
            >CLEAR</button>
            <button
              type="button"
              className="btn ghost"
              style={{ fontSize: 10 }}
              onClick={() => setTermOpen(false)}
              title="Hide terminal"
            >
              <Icon.close size={11} />
            </button>
          </div>
          <div className="log-body">
            {filteredLogs.length === 0 ? (
              <div className="log-empty">— no output for this run —</div>
            ) : filteredLogs.map((l) => (
              <div key={l.id} className={`log-line ${l.level}`}>
                <span className="lt">{l.ts}</span>
                <span className="lp">[{l.phase}]</span>
                <span className="lm">{stripAnsi(l.msg)}</span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      ) : (
        <button type="button" className="term-toggle" onClick={() => setTermOpen(true)}>
          <Icon.terminal size={12} />
          <span>Show terminal</span>
          <span className="spacer" />
          <span className="meta">{logs.length} events · live</span>
        </button>
      )}
    </div>
  );
}

/* ========================================================================
   Crawl tab
   ======================================================================== */
type TabProps = {
  appendLog: (run: RunKind, phase: string, msg: string, level?: LogLevel) => void;
  updateRun: (id: RunKind, patch: Partial<RunState>) => void;
  setRequests?: (n: number | ((prev: number) => number)) => void;
};

function CrawlTab({ appendLog, updateRun, setRequests }: TabProps) {
  const [seeds, setSeeds] = useState("");
  const [sourceLabel, setSourceLabel] = useState("crawl");
  const [maxDepth, setMaxDepth] = useState("3");
  const [maxPages, setMaxPages] = useState("500");
  const [scope, setScope] = useState("");
  const [audit, setAudit] = useState(true);
  const [follow, setFollow] = useState(true);
  const [jsRender, setJsRender] = useState(false);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  async function runCrawl() {
    if (!seeds.trim()) return;
    const seedLines = seeds.split("\n").map((s) => s.trim()).filter(Boolean);
    setBusy(true);
    appendLog("crawl", "crawl", `Starting crawl (${seedLines.length} seeds)`);
    updateRun("crawl", {
      title: "Crawl · " + (seedLines[0] ?? "seeds"),
      status: "running",
      visited: 0,
      total: Number(maxPages) || 100,
      pct: 0,
      meta: [[0, `/${maxPages} visited`], [0, " in queue"]],
    });
    if (audit) {
      updateRun("audit", {
        title: "Audit · passive",
        status: "running",
        visited: 0,
        total: 0,
        pct: 0,
        meta: [["passive", " headers/CORS/paths"]],
      });
    }

    const body: Record<string, unknown> = {
      seeds_file: seeds,
      source_label: sourceLabel,
      crawl_mode: audit ? "crawl_audit" : "crawl_only",
      modules: [],
    };
    if (maxDepth) body.max_depth = Number(maxDepth);
    if (maxPages) body.max_pages = Number(maxPages);
    const scopeHosts = scope.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    if (scopeHosts.length) body.scope_hosts = scopeHosts;
    if (jsRender) body.render_js = true;
    if (!follow) body.follow_redirects = false;

    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const r = await apiFetch("/api/ingest/crawl/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!r.ok) throw new Error((await r.text()) || r.statusText);
      await readSse(r, (evt) => {
        const t = evt.type as string | undefined;
        if (t === "progress") {
          const visited = Number(evt.visited ?? 0);
          const maxP = Number(evt.max_pages ?? maxPages ?? 100);
          const queue = Number(evt.queue_size ?? 0);
          const depth = Number(evt.depth ?? 0);
          const maxD = Number(evt.max_depth ?? maxDepth ?? 0);
          const pct = maxP > 0 ? (visited / maxP) * 100 : 0;
          updateRun("crawl", {
            visited,
            total: maxP,
            pct,
            status: "running",
            meta: [
              [visited, `/${maxP} visited`],
              [queue, " in queue"],
              [`depth ${depth}`, `/${maxD}`],
            ],
          });
          if (evt.current_url) {
            appendLog("crawl", "crawl", `[${visited}/${maxP}] ${evt.current_url}`);
            setRequests?.((n) => n + 1);
          }
        } else if (t === "crawl_complete") {
          appendLog("crawl", "crawl", `Crawl complete: ${evt.nodes} nodes, ${evt.edges} edges`, "success");
        } else if (t === "scan_progress") {
          const scanner = String(evt.scanner ?? "audit");
          const phase = String(evt.phase ?? "");
          const detail = String(evt.detail ?? "");
          if (phase === "error") appendLog("audit", scanner, detail, "error");
          else if (phase === "complete") appendLog("audit", scanner, `done`, "success");
          else if (detail) appendLog("audit", scanner, detail);
        } else if (t === "phase_start" && evt.phase === "scanning") {
          appendLog("audit", "audit", `Scanning ${evt.targets ?? 0} targets`);
        } else if (t === "phase_complete") {
          if (audit) updateRun("audit", { status: "done", pct: 100 });
        } else if (t === "complete") {
          appendLog("crawl", "crawl", `Done: ${evt.nodes} nodes, ${evt.edges} edges`, "success");
          updateRun("crawl", { status: "done", pct: 100 });
          if (audit) updateRun("audit", { status: "done", pct: 100 });
        } else if (t === "error") {
          appendLog("crawl", "crawl", `Error: ${evt.detail}`, "error");
          updateRun("crawl", { status: "error" });
        }
      }, ac.signal);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        appendLog("crawl", "crawl", String(err), "error");
        updateRun("crawl", { status: "error" });
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function stopCrawl() {
    abortRef.current?.abort();
    updateRun("crawl", { status: "paused" });
    appendLog("crawl", "crawl", "Stopped", "warn");
  }

  async function clearGraph() {
    if (!confirm("Clear all nodes and edges?")) return;
    appendLog("crawl", "system", "Clearing graph...");
    try {
      await apiJson("/api/graph", { method: "DELETE" });
      appendLog("crawl", "system", "Graph cleared", "success");
    } catch (err) {
      appendLog("crawl", "system", String(err), "error");
    }
  }

  return (
    <>
      <div className="field">
        <label>Seeds <span style={{ color: "var(--fg-3)" }}>one per line, or path to seeds file</span></label>
        <textarea
          className="input mono"
          value={seeds}
          onChange={(e) => setSeeds(e.target.value)}
          placeholder={"https://example.com\nhttps://api.example.com"}
        />
      </div>

      <div className="row-3">
        <div className="field">
          <label>Max depth</label>
          <input className="input mono" value={maxDepth} onChange={(e) => setMaxDepth(e.target.value)} />
        </div>
        <div className="field">
          <label>Max pages</label>
          <input className="input mono" value={maxPages} onChange={(e) => setMaxPages(e.target.value)} />
        </div>
        <div className="field">
          <label>Source label</label>
          <input className="input mono" value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} />
        </div>
      </div>

      <div className="field">
        <label>Scope (comma or newline, glob supported)</label>
        <input
          className="input mono"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          placeholder="example.com, *.example.com"
        />
        <span className="hint">Only hosts matching the scope will be requested. Wildcards allowed.</span>
      </div>

      <div className="field">
        <label>Options</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <button type="button" className={`check ${audit ? "on" : ""}`} onClick={() => setAudit(!audit)}>
            <span className="check-box" /> Passive audit
          </button>
          <button type="button" className={`check ${follow ? "on" : ""}`} onClick={() => setFollow(!follow)}>
            <span className="check-box" /> Follow redirects
          </button>
          <button type="button" className={`check ${jsRender ? "on" : ""}`} onClick={() => setJsRender(!jsRender)}>
            <span className="check-box" /> Render JS (headless)
          </button>
        </div>
      </div>

      <div className="actions-row">
        <button
          type="button"
          className="btn primary"
          onClick={() => void runCrawl()}
          disabled={busy || !seeds.trim()}
        >
          {busy ? <><Icon.pause size={12} /> Running…</> : <><Icon.play size={12} /> Start crawl</>}
        </button>
        {busy && (
          <button type="button" className="btn danger" onClick={stopCrawl}>
            <Icon.stop size={12} /> Stop
          </button>
        )}
        <button type="button" className="btn danger" onClick={() => void clearGraph()}>
          Clear graph
        </button>
      </div>
    </>
  );
}

/* ========================================================================
   Fuzz tab
   ======================================================================== */
function FuzzTab({ appendLog, updateRun, setRequests }: TabProps) {
  const [target, setTarget] = useState("");
  const [hosts, setHosts] = useState<string[]>([]);
  const [fuzzer, setFuzzer] = useState<"ffuf" | "feroxbuster">("ffuf");
  const [wordlist, setWordlist] = useState("");
  const [extensions, setExtensions] = useState("");
  const [threads, setThreads] = useState("40");
  const [matchStatus, setMatchStatus] = useState("200,301,403");
  const [filterSize, setFilterSize] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    apiJson<{ hosts: string[] }>("/api/graph/hosts")
      .then((d) => setHosts(d.hosts || []))
      .catch(() => {});
  }, []);

  function buildExtraArgs(): string[] {
    const args: string[] = [];
    if (fuzzer === "ffuf") {
      if (extensions.trim()) args.push("-e", extensions.trim());
      if (threads.trim()) args.push("-t", threads.trim());
      if (matchStatus.trim()) args.push("-mc", matchStatus.trim());
      if (filterSize.trim()) args.push("-fs", filterSize.trim());
    } else {
      if (extensions.trim()) args.push("-x", extensions.trim());
      if (threads.trim()) args.push("-t", threads.trim());
      if (matchStatus.trim()) args.push("-s", matchStatus.trim());
      if (filterSize.trim()) args.push("-S", filterSize.trim());
    }
    return args;
  }

  async function runFuzz() {
    if (!target.trim()) return;
    setBusy(true);
    appendLog("fuzz", fuzzer, `Starting ${fuzzer} against ${target}`);
    updateRun("fuzz", {
      title: `${fuzzer} · ${target}`,
      status: "running",
      visited: 0,
      total: 0,
      pct: 0,
      meta: [[0, " hits"]],
    });

    const body = {
      tool_id: fuzzer,
      targets: [target],
      wordlist: wordlist || null,
      extra_args: buildExtraArgs(),
    };
    const ac = new AbortController();
    abortRef.current = ac;
    let hits = 0;
    try {
      const r = await apiFetch("/api/tools/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!r.ok) throw new Error((await r.text()) || r.statusText);
      await readSse(r, (evt) => {
        const t = evt.type as string | undefined;
        if (t === "progress" && evt.phase === "starting" && evt.command) {
          appendLog("fuzz", fuzzer, `$ ${evt.command}`);
        } else if (t === "progress" && evt.output) {
          const raw = String(evt.output);
          const clean = stripAnsi(raw);
          const level = ansiLevel(raw);
          appendLog("fuzz", fuzzer, clean, level);
          if (clean.includes("[Status:")) {
            hits += 1;
            updateRun("fuzz", { meta: [[hits, " hits"]] });
          }
          const m = clean.match(/Progress:\s*\[(\d+)\/(\d+)\]/);
          if (m) {
            const done = Number(m[1]);
            const total = Number(m[2]);
            if (total > 0) {
              updateRun("fuzz", {
                visited: done,
                total,
                pct: (done / total) * 100,
                meta: [[done, `/${total} entries`], [hits, " hits"]],
              });
            }
          }
          setRequests?.((n) => n + 1);
        } else if (t === "complete") {
          if (evt.ingested && typeof evt.ingested === "object") {
            const ing = evt.ingested as { nodes?: number; edges?: number };
            appendLog("fuzz", fuzzer, `✓ Ingested: ${ing.nodes ?? 0} nodes, ${ing.edges ?? 0} edges`, "success");
          } else if (evt.error) {
            appendLog("fuzz", fuzzer, `✗ ${evt.error}`, "error");
          } else {
            appendLog("fuzz", fuzzer, `✓ Done (exit ${evt.exit_code ?? "?"}, ${evt.elapsed_seconds ?? "?"}s)`, "success");
          }
          updateRun("fuzz", { status: "done", pct: 100 });
        } else if (t === "error") {
          appendLog("fuzz", fuzzer, `Error: ${evt.detail}`, "error");
          updateRun("fuzz", { status: "error" });
        }
      }, ac.signal);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        appendLog("fuzz", fuzzer, String(err), "error");
        updateRun("fuzz", { status: "error" });
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function stopFuzz() {
    abortRef.current?.abort();
    updateRun("fuzz", { status: "paused" });
    appendLog("fuzz", fuzzer, "Stopped", "warn");
  }

  return (
    <>
      <div className="field">
        <label>Target URL pattern</label>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            className="input mono"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="https://example.com/FUZZ"
            style={{ flex: 1 }}
          />
          {hosts.length > 0 && (
            <select
              className="input mono"
              value=""
              onChange={(e) => { if (e.target.value) setTarget(e.target.value + "/FUZZ"); }}
              style={{ maxWidth: 160 }}
            >
              <option value="">From graph…</option>
              {hosts.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          )}
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label>Fuzzer</label>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" className={`check ${fuzzer === "ffuf" ? "on" : ""}`} onClick={() => setFuzzer("ffuf")}>
              <span className="check-box" /> ffuf
            </button>
            <button type="button" className={`check ${fuzzer === "feroxbuster" ? "on" : ""}`} onClick={() => setFuzzer("feroxbuster")}>
              <span className="check-box" /> Feroxbuster
            </button>
          </div>
        </div>
        <div className="field">
          <label>Wordlist</label>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              className="input mono"
              value={wordlist}
              onChange={(e) => setWordlist(e.target.value)}
              placeholder="default"
              style={{ flex: 1 }}
            />
            <WordlistPicker current={wordlist} onSelect={setWordlist} />
          </div>
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label>Extensions</label>
          <input
            className="input mono"
            value={extensions}
            onChange={(e) => setExtensions(e.target.value)}
            placeholder=".bak,.zip,.env"
          />
        </div>
        <div className="field">
          <label>Threads</label>
          <input className="input mono" value={threads} onChange={(e) => setThreads(e.target.value)} />
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label>Match status</label>
          <input className="input mono" value={matchStatus} onChange={(e) => setMatchStatus(e.target.value)} />
        </div>
        <div className="field">
          <label>Filter size</label>
          <input className="input mono" value={filterSize} onChange={(e) => setFilterSize(e.target.value)} placeholder="e.g. 0" />
        </div>
      </div>

      <div className="actions-row">
        <button
          type="button"
          className="btn primary"
          onClick={() => void runFuzz()}
          disabled={busy || !target.trim()}
        >
          <Icon.play size={12} /> {busy ? `Running ${fuzzer}…` : `Start ${fuzzer}`}
        </button>
        {busy && (
          <button type="button" className="btn danger" onClick={stopFuzz}>
            <Icon.stop size={12} /> Stop
          </button>
        )}
      </div>
    </>
  );
}

/* ========================================================================
   Scan tab
   ======================================================================== */
function ScanTab({ appendLog, updateRun }: TabProps) {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [enabledWeb, setEnabledWeb] = useState<Set<string>>(new Set(["nuclei"]));
  const [enabledLocal, setEnabledLocal] = useState<Set<string>>(new Set());
  const [templates, setTemplates] = useState("");
  const [severityIdx, setSeverityIdx] = useState(2);
  const [hosts, setHosts] = useState<string[]>([]);
  const [target, setTarget] = useState("");
  const [presets, setPresets] = useState<ScanPreset[]>([]);
  const [preset, setPreset] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    apiJson<Plugin[]>("/api/plugins")
      .then((ps) => {
        const scannerPlugins = ps.filter((p) => p.type === "scanner" || p.type === "web" || p.type === "local" || ["nuclei", "trivy", "gitleaks", "semgrep", "grype"].includes(p.id));
        setPlugins(scannerPlugins.length ? scannerPlugins : FALLBACK_SCANNERS);
      })
      .catch(() => setPlugins(FALLBACK_SCANNERS));
    apiJson<{ hosts: string[] }>("/api/graph/hosts")
      .then((d) => setHosts(d.hosts || []))
      .catch(() => {});
    apiJson<ScanPreset[]>("/api/scan-presets")
      .then((ps) => setPresets(Array.isArray(ps) ? ps : []))
      .catch(() => {});
  }, []);

  const webScanners = useMemo(
    () => plugins.filter((p) => p.id === "nuclei" || p.type === "web"),
    [plugins],
  );
  const localScanners = useMemo(
    () => plugins.filter((p) => p.id !== "nuclei" && p.type !== "web"),
    [plugins],
  );

  function toggle(set: Set<string>, setFn: (s: Set<string>) => void, id: string) {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setFn(n);
  }

  function applyPreset(name: string) {
    setPreset(name);
    const p = presets.find((x) => x.name === name);
    if (!p) return;
    const summary = (p.scanner_summary || "").toLowerCase();
    const webIds = new Set<string>();
    const localIds = new Set<string>();
    for (const plugin of plugins) {
      if (summary.includes(plugin.id)) {
        if (plugin.id === "nuclei" || plugin.type === "web") webIds.add(plugin.id);
        else localIds.add(plugin.id);
      }
    }
    if (webIds.size) setEnabledWeb(webIds);
    if (localIds.size) setEnabledLocal(localIds);
  }

  async function runWebScan() {
    if (enabledWeb.size === 0) return;
    setBusy(true);
    const label = Array.from(enabledWeb).join(",");
    appendLog("scan", "scan", `Starting web scan: ${label}`);
    updateRun("scan", {
      title: `Scan · ${label}`,
      status: "running",
      visited: 0,
      total: 0,
      pct: 0,
      meta: [[0, " scanned"]],
    });

    const severity = SEVERITIES.slice(severityIdx).join(",");
    const extraArgs = templates.trim()
      ? ["-t", templates.trim(), "-severity", severity]
      : ["-severity", severity];

    const body: Record<string, unknown> = {
      seeds_file: "",
      source_label: "scan",
      crawl_mode: "crawl_only",
      skip_crawl: true,
      modules: webScanners.map((m) => ({
        id: m.id,
        enabled: enabledWeb.has(m.id),
        wordlist: null,
        extra_args: enabledWeb.has(m.id) && m.id === "nuclei" ? extraArgs : [],
      })),
    };

    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const r = await apiFetch("/api/ingest/crawl/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!r.ok) throw new Error((await r.text()) || r.statusText);
      let scannedCount = 0;
      await readSse(r, (evt) => {
        const t = evt.type as string | undefined;
        if (t === "phase_start") appendLog("scan", "scan", `Scanning ${evt.targets ?? 0} targets`);
        else if (t === "scan_progress") {
          const scanner = String(evt.scanner ?? "");
          const phase = String(evt.phase ?? "");
          const detail = String(evt.detail ?? "");
          if (phase === "error") appendLog("scan", scanner, detail, "error");
          else if (phase === "complete") {
            scannedCount += 1;
            const ing = (evt.ingested ?? {}) as { nodes?: number; edges?: number };
            appendLog("scan", scanner, ing.nodes != null ? `${ing.nodes} nodes, ${ing.edges ?? 0} edges` : "done", "success");
            updateRun("scan", { meta: [[scannedCount, " scanned"]] });
          } else if (phase === "info") appendLog("scan", scanner, detail, "warn");
          else if (detail) appendLog("scan", scanner, detail);
        } else if (t === "phase_complete") {
          appendLog("scan", "scan", "Scan phase complete", "success");
          updateRun("scan", { status: "done", pct: 100 });
        } else if (t === "complete") {
          appendLog("scan", "scan", "Scan complete", "success");
          updateRun("scan", { status: "done", pct: 100 });
        } else if (t === "error") {
          appendLog("scan", "scan", `Error: ${evt.detail}`, "error");
          updateRun("scan", { status: "error" });
        }
      }, ac.signal);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        appendLog("scan", "scan", String(err), "error");
        updateRun("scan", { status: "error" });
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  async function runFetchAndScan() {
    const t = target || hosts[0] || "";
    if (!t || enabledLocal.size === 0) return;
    setBusy(true);
    const ids = Array.from(enabledLocal);
    appendLog("scan", "fetch", `Downloading content from ${t}...`);
    updateRun("scan", {
      title: `Scan · ${ids.join(",")}`,
      status: "running",
      visited: 0,
      total: 0,
      pct: 0,
      meta: [[0, " files"]],
    });

    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const r = await apiFetch("/api/scan/fetch-and-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base_url: t, scanner_ids: ids }),
        signal: ac.signal,
      });
      if (!r.ok) throw new Error((await r.text()) || r.statusText);
      await readSse(r, (evt) => {
        const tt = evt.type as string | undefined;
        if (tt === "status") appendLog("scan", "fetch", String(evt.detail ?? ""));
        else if (tt === "scanner_start") appendLog("scan", String(evt.scanner ?? "scan"), "starting...");
        else if (tt === "scanner_progress") {
          if (evt.output) appendLog("scan", String(evt.scanner ?? "scan"), String(evt.output));
        } else if (tt === "scanner_done") {
          const scanner = String(evt.scanner ?? "scan");
          if (evt.ingested) {
            const ing = evt.ingested as { nodes?: number; edges?: number };
            appendLog("scan", scanner, `✓ ${ing.nodes ?? 0} nodes, ${ing.edges ?? 0} edges`, "success");
          } else if (evt.error) appendLog("scan", scanner, `✗ ${evt.error}`, "error");
          else appendLog("scan", scanner, `done (exit ${evt.exit_code ?? "?"})`, "success");
        } else if (tt === "complete") {
          if (evt.ok) {
            appendLog("scan", "fetch", `Scan complete (${evt.files ?? "?"} files scanned)`, "success");
            updateRun("scan", { status: "done", pct: 100, meta: [[Number(evt.files ?? 0), " files"]] });
          } else {
            appendLog("scan", "fetch", `Failed: ${evt.error}`, "error");
            updateRun("scan", { status: "error" });
          }
        } else if (tt === "error") {
          appendLog("scan", "scan", `Error: ${evt.detail}`, "error");
          updateRun("scan", { status: "error" });
        }
      }, ac.signal);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        appendLog("scan", "scan", String(err), "error");
        updateRun("scan", { status: "error" });
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function stopScan() {
    abortRef.current?.abort();
    updateRun("scan", { status: "paused" });
    appendLog("scan", "scan", "Stopped", "warn");
  }

  const hostCount = hosts.length;

  return (
    <>
      <div className="field">
        <label>Scanners</label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[...webScanners, ...localScanners].map((s) => {
            const isWeb = s.id === "nuclei" || s.type === "web";
            const on = (isWeb ? enabledWeb : enabledLocal).has(s.id);
            return (
              <button
                key={s.id}
                type="button"
                className={`check ${on ? "on" : ""}`}
                onClick={() => toggle(isWeb ? enabledWeb : enabledLocal, isWeb ? setEnabledWeb : setEnabledLocal, s.id)}
                title={s.installed === false ? "Not installed" : undefined}
              >
                <span className="check-box" /> {s.name}
                <span style={{ color: "var(--fg-3)", marginLeft: 4, fontSize: 11 }}>{s.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      {presets.length > 0 && (
        <div className="field">
          <label>Preset</label>
          <select
            className="input mono"
            value={preset}
            onChange={(e) => applyPreset(e.target.value)}
          >
            <option value="">— custom —</option>
            {presets.map((p) => (
              <option key={p.name} value={p.name}>{p.name} — {p.description}</option>
            ))}
          </select>
        </div>
      )}

      <div className="field">
        <label>Templates (Nuclei)</label>
        <input
          className="input mono"
          value={templates}
          onChange={(e) => setTemplates(e.target.value)}
          placeholder="exposures/, vulnerabilities/, misconfig/"
        />
        <span className="hint">Limit Nuclei to specific template categories.</span>
      </div>

      <div className="field">
        <label>Severity threshold</label>
        <div className="chip-row">
          {SEVERITIES.map((s, i) => (
            <button
              key={s}
              type="button"
              className={`chip ${i >= severityIdx ? "on" : ""}`}
              onClick={() => setSeverityIdx(i)}
            >{s}</button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>Target (for local scanners)</label>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            className="input mono"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="http://target (fetch & scan) or /local/path"
            style={{ flex: 1 }}
          />
          {hosts.length > 0 && (
            <select
              className="input mono"
              value=""
              onChange={(e) => { if (e.target.value) setTarget(e.target.value); }}
              style={{ maxWidth: 160 }}
            >
              <option value="">From graph…</option>
              {hosts.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          )}
        </div>
      </div>

      <div className="actions-row">
        <button
          type="button"
          className="btn primary"
          onClick={() => void runWebScan()}
          disabled={busy || enabledWeb.size === 0}
        >
          <Icon.scan size={12} /> {busy ? "Scanning…" : `Run web scan${hostCount ? ` on ${hostCount} hosts` : ""}`}
        </button>
        {(target.startsWith("http://") || target.startsWith("https://")) && enabledLocal.size > 0 && (
          <button
            type="button"
            className="btn primary"
            onClick={() => void runFetchAndScan()}
            disabled={busy}
          >
            <Icon.scan size={12} /> Fetch & scan
          </button>
        )}
        {busy && (
          <button type="button" className="btn danger" onClick={stopScan}>
            <Icon.stop size={12} /> Stop
          </button>
        )}
      </div>
    </>
  );
}

/* ========================================================================
   Import tab
   ======================================================================== */
function ImportTab({ appendLog, updateRun }: TabProps) {
  const [ingestorNames, setIngestorNames] = useState<string[]>([]);
  const [hint, setHint] = useState("");
  const [sourceLabel, setSourceLabel] = useState(`import-${new Date().toISOString().slice(0, 10)}`);
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiJson<{ name: string }[]>("/api/ingestors")
      .then((r) => setIngestorNames(r.map((x) => x.name)))
      .catch(() => {});
  }, []);

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  }
  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) setFile(f);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    appendLog("import", "ingest", `Uploading ${file.name}…`);
    updateRun("import", {
      title: `Import · ${file.name}`,
      status: "running",
      visited: 0,
      total: 1,
      pct: 10,
      meta: [[file.name, ""]],
    });
    const fd = new FormData();
    fd.append("file", file);
    const q = new URLSearchParams({ source_label: sourceLabel });
    if (hint) q.set("ingestor_hint", hint);
    try {
      const r = await apiFetch(`/api/ingest?${q}`, { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || JSON.stringify(j));
      appendLog("import", "ingest", `Ingested: ${j.nodes} nodes, ${j.edges} edges`, "success");
      updateRun("import", {
        status: "done",
        pct: 100,
        meta: [[j.nodes, " nodes"], [j.edges, " edges"]],
      });
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      appendLog("import", "ingest", String(err), "error");
      updateRun("import", { status: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <datalist id="ops-ingestor-hints">
        {ingestorNames.map((n) => <option key={n} value={n} />)}
      </datalist>

      <div className="field">
        <label>Ingestor</label>
        <input
          className="input mono"
          value={hint}
          onChange={(e) => setHint(e.target.value)}
          list="ops-ingestor-hints"
          placeholder="auto"
        />
        <span className="hint">Autodetect: {ingestorNames.slice(0, 8).join(" · ") || "burp-xml · zap-json · httpx · ffuf"}</span>
      </div>

      <div className="field">
        <label>Upload</label>
        <div
          className={`ops-dropzone ${drag ? "drag" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <Icon.upload size={32} />
          <div className="drop-main">
            {file ? file.name : "Drop Burp / ZAP / httpx export here"}
          </div>
          <div className="drop-sub">
            {file
              ? <>size: {(file.size / 1024).toFixed(1)} KB · <span className="pick">change…</span></>
              : <>or <span className="pick">browse files</span></>}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            style={{ display: "none" }}
            onChange={onPick}
          />
        </div>
      </div>

      <div className="field">
        <label>Source label</label>
        <input
          className="input mono"
          value={sourceLabel}
          onChange={(e) => setSourceLabel(e.target.value)}
        />
      </div>

      <div className="actions-row">
        <button
          type="submit"
          className="btn primary"
          disabled={busy || !file}
        >
          <Icon.upload size={12} /> {busy ? "Uploading…" : "Import"}
        </button>
      </div>
    </form>
  );
}

/* ========================================================================
   Wordlist picker (modal)
   ======================================================================== */
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
    apiJson<{ wordlists: Wordlist[] }>(`/api/wordlists?${params}`)
      .then((d) => setWordlists(d.wordlists || []))
      .catch(() => setWordlists([]));
  }, [open, search, category]);

  const categories = useMemo(
    () => [...new Set(wordlists.map((w) => w.category))].sort(),
    [wordlists],
  );

  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>Pick…</button>
      {open && (
        <div className="ops-wl-picker-overlay" onClick={() => setOpen(false)}>
          <div className="ops-wl-picker" onClick={(e) => e.stopPropagation()}>
            <div className="ops-wl-picker-header">
              <h3>Select Wordlist</h3>
              <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
                <Icon.close size={12} />
              </button>
            </div>
            <div className="ops-wl-picker-filters">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search wordlists…"
                autoFocus
                className="ops-wl-picker-search"
              />
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="ops-wl-picker-cat"
              >
                <option value="">All categories</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="ops-wl-picker-list">
              {wordlists.map((w) => (
                <button
                  key={w.path}
                  type="button"
                  className={`ops-wl-picker-item ${w.path === current ? "active" : ""}`}
                  onClick={() => { onSelect(w.path); setOpen(false); }}
                >
                  <span className="wl-name">{w.name}</span>
                  <span className="wl-meta">
                    <span className="wl-cat-badge">{w.category}</span>
                    <span>{w.lines.toLocaleString()} lines</span>
                  </span>
                  <span className="wl-path">{w.relative}</span>
                </button>
              ))}
              {wordlists.length === 0 && (
                <div className="ops-wl-picker-empty">No wordlists found.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
