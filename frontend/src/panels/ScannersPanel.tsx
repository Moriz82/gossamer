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

type PluginInfo = {
  id: string;
  type: string;
  name: string;
  description: string;
  latest_version: string;
  installed_version: string | null;
  installed: boolean;
  binary_found: boolean;
  binary_path: string | null;
  source_repo: string;
  updatable: boolean;
  update_available: boolean;
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

  const [plugins, setPlugins] = useState<PluginInfo[] | null>(null);
  const [pluginBusy, setPluginBusy] = useState<string | null>(null);
  const [pluginMsg, setPluginMsg] = useState<string | null>(null);
  const pluginMsgTimer = useCallback((msg: string) => {
    setPluginMsg(msg);
    const t = setTimeout(() => setPluginMsg(null), 3000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    apiJson<PluginInfo[]>("/api/plugins").then(setPlugins).catch(() => {});
  }, []);

  async function pluginAction(
    busyId: string,
    action: () => Promise<unknown>,
    successMsg: string,
  ) {
    setPluginBusy(busyId);
    setPluginMsg(null);
    try {
      await action();
      const list = await apiJson<PluginInfo[]>("/api/plugins");
      setPlugins(list);
      pluginMsgTimer(successMsg);
    } catch (e) {
      setPluginMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setPluginBusy(null);
    }
  }

  const refreshPlugins = () =>
    pluginAction("__refresh__", () => Promise.resolve(), "Plugin list refreshed.");
  const installPlugin = (id: string) =>
    pluginAction(id, () => apiFetch(`/api/plugins/${id}/install`, { method: "POST" }), `${id} installed successfully.`);
  const updatePlugin = (id: string) =>
    pluginAction(id, () => apiFetch(`/api/plugins/${id}/update`, { method: "POST" }), `${id} updated successfully.`);
  const uninstallPlugin = (id: string) =>
    pluginAction(id, () => apiFetch(`/api/plugins/${id}`, { method: "DELETE" }), `${id} uninstalled.`);

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
        <div className="card-head">
          <h2>Plugin Store</h2>
          <button type="button" className="btn-secondary" onClick={() => void refreshPlugins()} disabled={!!pluginBusy}>
            Check for updates
          </button>
        </div>
        <p className="muted">
          Install and manage scanner tools. Binaries are downloaded from official GitHub releases.
        </p>
        {pluginMsg && <div className="plugin-msg">{pluginMsg}</div>}
        {plugins === null ? (
          <p className="muted">Loading plugins...</p>
        ) : plugins.length === 0 ? (
          <p className="empty-hint">No plugins available.</p>
        ) : (
          <div className="plugin-grid">
            {plugins.map((p) => (
              <div key={p.id} className="plugin-card">
                <div className="plugin-header">
                  <span className={`status-dot ${p.binary_found ? "green" : p.installed ? "yellow" : p.update_available ? "blue" : "gray"}`} />
                  <span className="plugin-name">{p.name}</span>
                  <span className="badge">{p.type}</span>
                </div>
                <p className="plugin-desc">{p.description}</p>
                <div className="plugin-meta">
                  {p.installed_version && (
                    <span className="plugin-version">v{p.installed_version}</span>
                  )}
                  {p.update_available && (
                    <span className="plugin-update-badge">&rarr; v{p.latest_version}</span>
                  )}
                  {!p.installed && (
                    <span className="plugin-version muted">v{p.latest_version}</span>
                  )}
                </div>
                <div className="plugin-actions">
                  {!p.installed ? (
                    <button type="button" className="primary" disabled={pluginBusy === p.id}
                      onClick={() => void installPlugin(p.id)}>
                      {pluginBusy === p.id ? "Installing..." : "Install"}
                    </button>
                  ) : p.update_available ? (
                    <button type="button" className="primary" disabled={pluginBusy === p.id}
                      onClick={() => void updatePlugin(p.id)}>
                      {pluginBusy === p.id ? "Updating..." : "Update"}
                    </button>
                  ) : (
                    <span className="plugin-installed-badge">Installed</span>
                  )}
                  {p.installed && (
                    <button type="button" className="ghost" disabled={pluginBusy === p.id}
                      onClick={() => void uninstallPlugin(p.id)}>
                      Uninstall
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

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
