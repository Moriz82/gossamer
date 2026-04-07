import { FormEvent, useEffect, useState } from "react";
import { apiFetch, apiJson } from "../api";

export default function OperationsPanel() {
  const [ingestorNames, setIngestorNames] = useState<string[]>([]);
  const [path, setPath] = useState("");
  const [sourceLabel, setSourceLabel] = useState("import");
  const [hint, setHint] = useState("");
  const [crawlSeeds, setCrawlSeeds] = useState("");
  const [crawlSource, setCrawlSource] = useState("crawl");
  const [maxDepth, setMaxDepth] = useState("");
  const [maxPages, setMaxPages] = useState("");
  const [scopeHosts, setScopeHosts] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiJson<{ name: string }[]>("/api/ingestors")
      .then((rows) => setIngestorNames(rows.map((r) => r.name)))
      .catch(() => setIngestorNames([]));
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
    const body: Record<string, unknown> = {
      seeds_file: crawlSeeds,
      source_label: crawlSource,
    };
    if (maxDepth) body.max_depth = Number(maxDepth);
    if (maxPages) body.max_pages = Number(maxPages);
    const lines = scopeHosts
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (lines.length) body.scope_hosts = lines;
    try {
      const j = await apiJson<Record<string, unknown>>("/api/ingest/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setMsg(`Crawl ingest: ${JSON.stringify(j)}`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
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
        <button type="submit" disabled={busy}>
          Upload & ingest
        </button>
      </form>

      <h3>Path on server</h3>
      <div className="form-grid">
        <label className="full">
          Absolute path
          <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/path/to/out.jsonl" />
        </label>
        <button type="button" onClick={() => void ingestByPath()} disabled={busy || !path}>
          Ingest path
        </button>
      </div>

      <h2>Crawl (.urlseed)</h2>
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
        <label className="full">
          Scope hosts (one per line, optional)
          <textarea value={scopeHosts} onChange={(e) => setScopeHosts(e.target.value)} rows={3} />
        </label>
        <button type="button" onClick={() => void runCrawl()} disabled={busy || !crawlSeeds}>
          Run crawl ingest
        </button>
      </div>

      <h2>Danger zone</h2>
      <button type="button" className="danger" onClick={() => void clearGraph()} disabled={busy}>
        Clear graph
      </button>

      {msg ? <pre className="panel-msg">{msg}</pre> : null}
    </div>
  );
}
