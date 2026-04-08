import { FormEvent, useEffect, useRef, useState } from "react";
import { apiFetch, apiJson, getAuthHeader } from "../api";

type CrawlProgress = {
  type: "progress" | "complete" | "crawl_complete" | "scan_progress" | "error";
  visited?: number;
  queue_size?: number;
  max_pages?: number;
  depth?: number;
  max_depth?: number;
  current_url?: string;
  nodes?: number;
  edges?: number;
  detail?: string;
};

export default function OperationsPanel() {
  const [ingestorNames, setIngestorNames] = useState<string[]>([]);
  const [path, setPath] = useState("");
  const [sourceLabel, setSourceLabel] = useState("import");
  const [hint, setHint] = useState("");
  const [crawlSeeds, setCrawlSeeds] = useState("");
  const [crawlSource, setCrawlSource] = useState("crawl");
  const [maxDepth, setMaxDepth] = useState("");
  const [maxPages, setMaxPages] = useState("");
  const [crawlMode, setCrawlMode] = useState<"crawl_only" | "crawl_audit">("crawl_only");
  const [scopeHosts, setScopeHosts] = useState("");
  const [presets, setPresets] = useState<{name: string; description: string; audit: boolean; scanner_summary: string}[] | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [crawlProgress, setCrawlProgress] = useState<CrawlProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    apiJson<{ name: string }[]>("/api/ingestors")
      .then((rows) => setIngestorNames(rows.map((r) => r.name)))
      .catch(() => setIngestorNames([]));
    apiJson<{name: string; description: string; audit: boolean; scanner_summary: string}[]>("/api/scan-presets")
      .then(setPresets).catch(() => {});
  }, []);

  async function onUpload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const input = form.elements.namedItem("file") as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      setMsg("Choose a file.");
      return;
    }
    setBusy(true);
    setMsg(null);
    const fd = new FormData();
    fd.append("file", file);
    const q = new URLSearchParams({ source_label: sourceLabel });
    if (hint) q.set("ingestor_hint", hint);
    try {
      const r = await apiFetch(`/api/ingest?${q}`, { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : JSON.stringify(j));
      setMsg(`Uploaded: ${JSON.stringify(j)}`);
      input.value = "";
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function ingestByPath() {
    setBusy(true);
    setMsg(null);
    try {
      const j = await apiJson<Record<string, unknown>>("/api/ingest/path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path,
          source_label: sourceLabel,
          ingestor_hint: hint || null,
        }),
      });
      setMsg(`Ingested: ${JSON.stringify(j)}`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function runCrawl() {
    setBusy(true);
    setMsg(null);
    setCrawlProgress(null);
    const reqBody: Record<string, unknown> = {
      seeds_file: crawlSeeds,
      source_label: crawlSource,
      crawl_mode: selectedPreset ? "crawl_audit" : crawlMode,
      scan_preset: selectedPreset || undefined,
    };
    if (maxDepth) reqBody.max_depth = Number(maxDepth);
    if (maxPages) reqBody.max_pages = Number(maxPages);
    const lines = scopeHosts
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (lines.length) reqBody.scope_hosts = lines;

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const r = await apiFetch("/api/ingest/crawl/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
        signal: ac.signal,
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(t || r.statusText);
      }
      const reader = r.body?.getReader();
      if (!reader) throw new Error("No response body");
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() || "";
        for (const part of parts) {
          const line = part.replace(/^data: /, "").trim();
          if (!line) continue;
          try {
            const evt = JSON.parse(line) as CrawlProgress & { scanner?: string; phase?: string };
            if (evt.type === "progress") {
              setCrawlProgress(evt);
            } else if (evt.type === "crawl_complete") {
              setCrawlProgress(null);
              setMsg(`Crawl done: ${evt.nodes} nodes, ${evt.edges} edges. ${selectedPreset ? "Running scanners..." : ""}`);
            } else if (evt.type === "scan_progress") {
              setMsg(`Scanner ${evt.scanner || "?"}: ${evt.phase || "running"}`);
            } else if (evt.type === "complete") {
              setCrawlProgress(null);
              setMsg(`Complete: ${evt.nodes} nodes, ${evt.edges} edges`);
            } else if (evt.type === "error") {
              setCrawlProgress(null);
              setMsg(`Error: ${evt.detail}`);
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setMsg(err instanceof Error ? err.message : String(err));
      }
      setCrawlProgress(null);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  async function clearGraph() {
    if (!confirm("Clear all nodes and edges from the database?")) return;
    setBusy(true);
    setMsg(null);
    try {
      await apiJson("/api/graph", { method: "DELETE" });
      setMsg("Graph cleared.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel-block">
      <datalist id="ingestor-hints">
        {ingestorNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <div className="card">
        <h2>Ingest</h2>
        <p className="muted">
          Upload tool output or reference a <strong>server-visible path</strong>. Ingestor names match the{" "}
          <strong>Ingestors</strong> tab; use a hint when auto-detection is wrong.
        </p>

        <form className="form-grid" onSubmit={onUpload}>
          <label>
            File upload
            <input name="file" type="file" />
          </label>
          <label>
            Source label
            <input value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} />
          </label>
          <label>
            Ingestor hint (optional)
            <input
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder="select or type"
              list="ingestor-hints"
            />
          </label>
          <div className="form-actions">
            <button type="submit" disabled={busy}>
              Upload & ingest
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h3>Path on server</h3>
        <div className="form-grid">
          <label className="full">
            Absolute path
            <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/path/to/out.jsonl" />
          </label>
          <div className="form-actions">
            <button type="button" onClick={() => void ingestByPath()} disabled={busy || !path}>
              Ingest path
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Crawl (.urlseed)</h2>
        <p className="muted">
          <strong>Crawl only</strong> discovers hosts, endpoints, links, and forms.{" "}
          <strong>Crawl + passive audit</strong> adds <code>Finding</code> nodes for HTTP 401/403/5xx, and
          missing baseline security headers on HTML responses (no external scanner binaries).
        </p>
        <div className="form-grid">
          <label className="full">
            Seeds file path (server)
            <input
              value={crawlSeeds}
              onChange={(e) => setCrawlSeeds(e.target.value)}
              placeholder="/path/to/seeds.urlseed"
            />
          </label>
          <label>
            Source label
            <input value={crawlSource} onChange={(e) => setCrawlSource(e.target.value)} />
          </label>
          <label>
            Max depth (optional)
            <input value={maxDepth} onChange={(e) => setMaxDepth(e.target.value)} placeholder="3" />
          </label>
          <label>
            Max pages (optional)
            <input value={maxPages} onChange={(e) => setMaxPages(e.target.value)} placeholder="100" />
          </label>
          <div className="full">
            <div className="preset-label">Scan preset</div>
            <div className="preset-cards">
              <button type="button" className={`preset-card ${!selectedPreset ? "preset-card-active" : ""}`} onClick={() => { setSelectedPreset(null); setCrawlMode("crawl_only"); }}>
                <div className="preset-card-name">None</div>
                <div className="preset-card-desc">Crawl only — discover surface without scanning</div>
              </button>
              {presets?.map(p => (
                <button key={p.name} type="button" className={`preset-card ${selectedPreset === p.name ? "preset-card-active" : ""}`} onClick={() => setSelectedPreset(p.name)}>
                  <div className="preset-card-name">{p.name}</div>
                  <div className="preset-card-desc">{p.description}</div>
                  <div className="preset-card-scanners">{p.scanner_summary}</div>
                </button>
              ))}
            </div>
          </div>
          <label className="full">
            Scope hosts (one per line, optional)
            <textarea value={scopeHosts} onChange={(e) => setScopeHosts(e.target.value)} rows={3} />
          </label>
          <div className="form-actions">
            <button type="button" onClick={() => void runCrawl()} disabled={busy || !crawlSeeds}>
              {busy && crawlProgress ? "Crawling..." : "Run crawl ingest"}
            </button>
            {busy && abortRef.current && (
              <button
                type="button"
                className="danger"
                onClick={() => abortRef.current?.abort()}
              >
                Cancel
              </button>
            )}
          </div>
          {crawlProgress && (
            <div className="crawl-progress">
              <div className="crawl-progress-bar-bg">
                <div
                  className="crawl-progress-bar"
                  style={{ width: `${Math.min(100, ((crawlProgress.visited || 0) / (crawlProgress.max_pages || 100)) * 100)}%` }}
                />
              </div>
              <div className="crawl-progress-stats">
                <span>{crawlProgress.visited}/{crawlProgress.max_pages} pages</span>
                <span>depth {crawlProgress.depth}/{crawlProgress.max_depth}</span>
                <span>{crawlProgress.queue_size} queued</span>
                <span>{crawlProgress.nodes} nodes</span>
                <span>{crawlProgress.edges} edges</span>
              </div>
              <div className="crawl-progress-url" title={crawlProgress.current_url}>
                {crawlProgress.current_url}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="card danger-card">
        <h2>Danger zone</h2>
        <button type="button" className="danger" onClick={() => void clearGraph()} disabled={busy}>
          Clear graph
        </button>
      </div>

      {msg ? <pre className="panel-msg">{msg}</pre> : null}
    </div>
  );
}
