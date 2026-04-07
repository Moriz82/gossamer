import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, apiJson } from "../api";

type IngestorRow = { name: string; summary: string; hints: string; role: string };

type TemplateRow = {
  id: string;
  file: string;
  title: string;
  description: string;
  ingestor_hint: string;
  size_bytes: number;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ScannersPanel() {
  const [ingestors, setIngestors] = useState<IngestorRow[] | null>(null);
  const [templates, setTemplates] = useState<TemplateRow[] | null>(null);
  const [selTpl, setSelTpl] = useState<Set<string>>(new Set());
  const [tplBusy, setTplBusy] = useState(false);
  const [tplMsg, setTplMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let ok = true;
    Promise.all([
      apiJson<IngestorRow[]>("/api/ingestors"),
      apiJson<TemplateRow[]>("/api/templates").catch(() => [] as TemplateRow[]),
    ])
      .then(([rows, tpl]) => {
        if (ok) {
          setIngestors(rows);
          setTemplates(tpl);
        }
      })
      .catch((e) => {
        if (ok) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      ok = false;
    };
  }, []);

  const scanners = useMemo(
    () =>
      [...(ingestors ?? [])]
        .filter((r) => (r.role || "import").toLowerCase() === "scanner")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [ingestors],
  );

  const toggleTpl = useCallback((id: string) => {
    setSelTpl((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllTpl = useCallback(() => {
    if (!templates?.length) return;
    setSelTpl(new Set(templates.map((t) => t.id)));
  }, [templates]);

  const clearTpl = useCallback(() => setSelTpl(new Set()), []);

  const downloadTemplatesZip = useCallback(async (mode: "all" | "selected") => {
    setTplMsg(null);
    setTplBusy(true);
    try {
      const url =
        mode === "all"
          ? "/api/templates/download?all=1"
          : `/api/templates/download?ids=${encodeURIComponent([...selTpl].join(","))}`;
      const r = await apiFetch(url);
      if (!r.ok) {
        const t = await r.text();
        throw new Error(t || r.statusText);
      }
      const blob = await r.blob();
      const cd = r.headers.get("Content-Disposition");
      const match = cd?.match(/filename="([^"]+)"/);
      const name = match?.[1] ?? "gossamer-scanner-templates.zip";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
      setTplMsg("Download started.");
      setTimeout(() => setTplMsg(null), 2500);
    } catch (e) {
      setTplMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setTplBusy(false);
    }
  }, [selTpl]);

  if (err) {
    return <pre className="panel-msg">{err}</pre>;
  }

  return (
    <div className="panel-block">
      <div className="card">
        <h2>Example scanner templates</h2>
        <p className="muted">
          Download bundled JSON / JSONL samples (same files as <code>examples/scanners/</code>) for local
          testing or CI. Unzip and ingest by path on the server, or upload through <strong>Ingest &amp; crawl</strong>.
        </p>
        {!templates ? (
          <p className="muted">Loading templates…</p>
        ) : templates.length === 0 ? (
          <p className="empty-hint">No templates found — ensure examples/scanners exists on the API host.</p>
        ) : (
          <>
            <div className="template-toolbar">
              <button
                type="button"
                className="primary"
                disabled={tplBusy}
                onClick={() => void downloadTemplatesZip("all")}
              >
                Download all ({templates.length})
              </button>
              <button
                type="button"
                disabled={tplBusy || selTpl.size === 0}
                onClick={() => void downloadTemplatesZip("selected")}
              >
                Download selected ({selTpl.size})
              </button>
              <button type="button" className="ghost-inline" disabled={tplBusy} onClick={selectAllTpl}>
                Select all
              </button>
              <button type="button" className="ghost-inline" disabled={tplBusy} onClick={clearTpl}>
                Clear
              </button>
            </div>
            {tplMsg ? <p className="muted small-note">{tplMsg}</p> : null}
            <ul className="template-list">
              {templates.map((t) => (
                <li key={t.id} className="template-row">
                  <label className="template-check">
                    <input
                      type="checkbox"
                      checked={selTpl.has(t.id)}
                      onChange={() => toggleTpl(t.id)}
                    />
                    <span className="template-title">{t.title}</span>
                    <code className="template-id">{t.id}</code>
                    <span className="muted">{formatBytes(t.size_bytes)}</span>
                  </label>
                  {t.description ? <p className="template-desc muted">{t.description}</p> : null}
                  {t.ingestor_hint ? (
                    <p className="template-hint muted">
                      Hint: <code>{t.ingestor_hint}</code> · file <code>{t.file}</code>
                    </p>
                  ) : (
                    <p className="template-hint muted">
                      File <code>{t.file}</code>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="card">
        <h2>Vulnerability scanners</h2>
        <p className="muted">
          {ingestors
            ? `${scanners.length} vulnerability- and policy-scanner ingestors (SARIF, DAST, SCA, secrets, IaC). `
            : ""}
          Everything else lives under <strong>Ingestors</strong> with roles like <code>recon</code> /{" "}
          <code>crawl</code>.
        </p>
        {!ingestors ? (
          <p className="muted">Loading…</p>
        ) : scanners.length === 0 ? (
          <p className="empty-hint">No scanner ingestors registered.</p>
        ) : (
          <div className="settings-table-wrap">
            <table className="settings-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Summary</th>
                  <th>Formats / hints</th>
                </tr>
              </thead>
              <tbody>
                {scanners.map((r) => (
                  <tr key={r.name}>
                    <td>
                      <code>{r.name}</code>
                    </td>
                    <td>{r.summary}</td>
                    <td className="muted">{r.hints}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
