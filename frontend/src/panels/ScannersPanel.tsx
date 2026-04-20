import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  category?: string;
};

type ScanProgress = {
  type: string;
  phase?: string;
  lines_processed?: number;
  elapsed_seconds?: number;
  detail?: string;
  ok?: boolean;
  ingested?: { nodes: number; edges: number };
};

type ScannerStatus = "ready" | "update" | "install" | "disabled";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function statusFor(p: PluginInfo): ScannerStatus {
  if (p.update_available) return "update";
  if (p.installed && p.binary_found) return "ready";
  if (p.installed || p.binary_found) return "install";
  return "disabled";
}

function glyphStyle(s: ScannerStatus): React.CSSProperties {
  const live = s === "ready" || s === "update";
  return {
    background: live
      ? "color-mix(in oklch, var(--silk) 18%, transparent)"
      : "var(--bg-3)",
    color: live ? "var(--silk)" : "var(--fg-3)",
  };
}

function pillColor(s: ScannerStatus): string {
  if (s === "ready") return "var(--ok)";
  if (s === "update") return "var(--warn)";
  if (s === "install") return "var(--silk-dim)";
  return "var(--fg-3)";
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
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [searchFilter, setSearchFilter] = useState("");
  const [lastCheckTime, setLastCheckTime] = useState<string | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updatingAll, setUpdatingAll] = useState(false);

  const [configPlugin, setConfigPlugin] = useState<PluginInfo | null>(null);
  const [runPlugin, setRunPlugin] = useState<PluginInfo | null>(null);

  const [scanTargets, setScanTargets] = useState("");
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const scanAbortRef = useRef<AbortController | null>(null);

  const flashPluginMsg = useCallback((msg: string) => {
    setPluginMsg(msg);
    setTimeout(() => setPluginMsg(null), 3000);
  }, []);

  async function pluginAction(
    busyId: string,
    action: () => Promise<Response>,
    successMsg: string,
  ) {
    setPluginBusy(busyId);
    setPluginMsg(null);
    try {
      const r = await action();
      const data = await r.json();
      if (data.plugins) {
        setPlugins(data.plugins);
      } else {
        const list = await apiJson<PluginInfo[]>("/api/plugins");
        setPlugins(list);
      }
      flashPluginMsg(successMsg);
    } catch (e) {
      setPluginMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setPluginBusy(null);
    }
  }

  const installPlugin = (id: string) =>
    pluginAction(id, () => apiFetch(`/api/plugins/${id}/install`, { method: "POST" }), `${id} installed.`);
  const updatePlugin = (id: string) =>
    pluginAction(id, () => apiFetch(`/api/plugins/${id}/update`, { method: "POST" }), `${id} updated.`);
  const uninstallPlugin = (id: string) =>
    pluginAction(id, () => apiFetch(`/api/plugins/${id}`, { method: "DELETE" }), `${id} uninstalled.`);

  async function checkForUpdates() {
    setCheckingUpdates(true);
    setPluginMsg(null);
    try {
      await apiFetch("/api/plugins/check-updates", { method: "POST" });
      const list = await apiJson<PluginInfo[]>("/api/plugins");
      setPlugins(list);
      setLastCheckTime(new Date().toLocaleTimeString());
      flashPluginMsg("Update check complete.");
    } catch (e) {
      setPluginMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setCheckingUpdates(false);
    }
  }

  async function updateAllPlugins() {
    setUpdatingAll(true);
    setPluginMsg(null);
    try {
      const r = await apiFetch("/api/plugins/update-all", { method: "POST" });
      const data = await r.json();
      if (data.plugins) setPlugins(data.plugins);
      flashPluginMsg(`Updated ${data.updated?.length || 0} plugins.`);
    } catch (e) {
      setPluginMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setUpdatingAll(false);
    }
  }

  useEffect(() => {
    let ok = true;
    Promise.all([
      apiJson<IngestorRow[]>("/api/ingestors").catch(() => [] as IngestorRow[]),
      apiJson<TemplateRow[]>("/api/templates").catch(() => [] as TemplateRow[]),
      apiJson<PluginInfo[]>("/api/plugins").catch(() => [] as PluginInfo[]),
    ])
      .then(([rows, tpl, plg]) => {
        if (ok) {
          setIngestors(rows);
          setTemplates(tpl);
          setPlugins(plg);
        }
      })
      .catch((e) => {
        if (ok) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      ok = false;
    };
  }, []);

  const scannerIngestors = useMemo(
    () =>
      [...(ingestors ?? [])]
        .filter((r) => (r.role || "import").toLowerCase() === "scanner")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [ingestors],
  );

  const categories = useMemo(() => {
    if (!plugins) return ["all"];
    const cats = new Set(plugins.map((p) => p.category || "other"));
    return ["all", ...Array.from(cats).sort()];
  }, [plugins]);

  const filteredPlugins = useMemo(() => {
    if (!plugins) return [];
    return plugins.filter((p) => {
      if (categoryFilter !== "all" && (p.category || "other") !== categoryFilter) return false;
      if (searchFilter) {
        const q = searchFilter.toLowerCase();
        if (
          !p.name.toLowerCase().includes(q) &&
          !p.description.toLowerCase().includes(q) &&
          !p.id.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [plugins, categoryFilter, searchFilter]);

  const hasUpdates = useMemo(
    () => plugins?.some((p) => p.update_available) ?? false,
    [plugins],
  );

  const enabledCount = useMemo(
    () => plugins?.filter((p) => p.installed && p.binary_found).length ?? 0,
    [plugins],
  );
  const totalCount = plugins?.length ?? 0;

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

  async function runScan(pluginId: string) {
    if (!pluginId || !scanTargets.trim()) return;
    setScanBusy(true);
    setScanProgress(null);
    setScanMsg(null);
    const targets = scanTargets.split("\n").map((s) => s.trim()).filter(Boolean);
    const ac = new AbortController();
    scanAbortRef.current = ac;
    try {
      const r = await apiFetch(`/api/scanners/${pluginId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets }),
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
            const evt = JSON.parse(line) as ScanProgress;
            if (evt.type === "progress") {
              setScanProgress(evt);
            } else if (evt.type === "complete") {
              setScanProgress(null);
              if (evt.ok && evt.ingested) {
                setScanMsg(
                  `Scan complete: ${evt.ingested.nodes} nodes, ${evt.ingested.edges} edges ingested`,
                );
              } else if (evt.ok) {
                setScanMsg("Scan complete (no results to ingest)");
              } else {
                setScanMsg(`Scan finished with issues: ${JSON.stringify(evt)}`);
              }
            } else if (evt.type === "error") {
              setScanProgress(null);
              setScanMsg(`Error: ${evt.detail}`);
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setScanMsg(e instanceof Error ? e.message : String(e));
      }
      setScanProgress(null);
    } finally {
      setScanBusy(false);
      scanAbortRef.current = null;
    }
  }

  function stopScan(pluginId: string) {
    scanAbortRef.current?.abort();
    void apiFetch(`/api/scanners/${pluginId}/stop`, { method: "POST" });
  }

  const downloadTemplatesZip = useCallback(
    async (mode: "all" | "selected") => {
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
    },
    [selTpl],
  );

  if (err) {
    return <pre className="panel-msg">{err}</pre>;
  }

  const subText = plugins === null
    ? "Loading…"
    : `${totalCount} plugin${totalCount === 1 ? "" : "s"} · ${enabledCount} enabled`;

  return (
    <div className="screen">
      <div className="screen-header">
        <h1 className="screen-title">Scanners</h1>
        <span className="screen-sub">{subText}</span>
        {lastCheckTime && (
          <span className="screen-sub" style={{ marginLeft: "var(--sp-2)" }}>
            Last check: {lastCheckTime}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="btn"
          onClick={() => void checkForUpdates()}
          disabled={checkingUpdates || !!pluginBusy}
        >
          {checkingUpdates ? "Checking…" : "Check updates"}
        </button>
        {hasUpdates && (
          <button
            type="button"
            className="btn primary"
            onClick={() => void updateAllPlugins()}
            disabled={updatingAll || !!pluginBusy}
          >
            {updatingAll ? "Updating…" : "Update all"}
          </button>
        )}
      </div>

      <div className="screen-body">
        {pluginMsg && <div className="scanners-toast">{pluginMsg}</div>}

        <div className="scanners-filters">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`pill ${categoryFilter === cat ? "pill-active" : ""}`}
              onClick={() => setCategoryFilter(cat)}
            >
              {cat === "all" ? "All" : cat.toUpperCase()}
            </button>
          ))}
          <input
            type="text"
            className="scanner-search"
            placeholder="Search scanners…"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
          />
        </div>

        {plugins === null ? (
          <div className="scanners-empty">Loading scanners…</div>
        ) : filteredPlugins.length === 0 ? (
          <div className="scanners-empty">
            {totalCount === 0 ? "No scanners available." : "No scanners match your filters."}
          </div>
        ) : (
          <div className="scanners-grid">
            {filteredPlugins.map((p) => {
              const s = statusFor(p);
              const live = s === "ready" || s === "update";
              const version = p.installed_version || p.latest_version;
              return (
                <div key={p.id} className="scanner-card">
                  <div className="scanner-top">
                    <div className="insp-glyph" style={glyphStyle(s)}>
                      {p.name[0]?.toUpperCase() ?? "?"}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="scanner-name">{p.name}</div>
                      <div className="scanner-meta">
                        {(p.category || p.type || "scanner")} · v{version}
                      </div>
                    </div>
                    <span className="status-pill" style={{ color: pillColor(s) }}>
                      <span
                        className={`pulse${live ? " live" : ""}`}
                        style={{ background: pillColor(s) }}
                      />
                      {s}
                    </span>
                  </div>
                  <div className="scanner-desc">{p.description}</div>
                  <div className="scanner-actions">
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setConfigPlugin(p)}
                    >
                      Configure
                    </button>
                    {s === "ready" ? (
                      <button
                        type="button"
                        className="btn primary"
                        onClick={() => {
                          setRunPlugin(p);
                          setScanTargets("");
                          setScanMsg(null);
                          setScanProgress(null);
                        }}
                      >
                        Run
                      </button>
                    ) : s === "update" ? (
                      <button
                        type="button"
                        className="btn primary"
                        disabled={pluginBusy === p.id}
                        onClick={() => void updatePlugin(p.id)}
                      >
                        {pluginBusy === p.id ? "Updating…" : "Update"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn primary"
                        disabled={pluginBusy === p.id}
                        onClick={() => void installPlugin(p.id)}
                      >
                        {pluginBusy === p.id ? "Installing…" : "Install"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {configPlugin && (
        <ConfigureModal
          plugin={configPlugin}
          templates={templates}
          selTpl={selTpl}
          toggleTpl={toggleTpl}
          selectAllTpl={selectAllTpl}
          clearTpl={clearTpl}
          downloadTemplatesZip={downloadTemplatesZip}
          tplBusy={tplBusy}
          tplMsg={tplMsg}
          ingestorRow={scannerIngestors.find((r) => r.name === configPlugin.id) ?? null}
          pluginBusy={pluginBusy}
          onUninstall={() => void uninstallPlugin(configPlugin.id)}
          onClose={() => setConfigPlugin(null)}
        />
      )}

      {runPlugin && (
        <RunModal
          plugin={runPlugin}
          targets={scanTargets}
          onTargetsChange={setScanTargets}
          busy={scanBusy}
          progress={scanProgress}
          message={scanMsg}
          onRun={() => void runScan(runPlugin.id)}
          onStop={() => stopScan(runPlugin.id)}
          onClose={() => {
            if (scanBusy) stopScan(runPlugin.id);
            setRunPlugin(null);
          }}
        />
      )}
    </div>
  );
}

function ConfigureModal(props: {
  plugin: PluginInfo;
  templates: TemplateRow[] | null;
  selTpl: Set<string>;
  toggleTpl: (id: string) => void;
  selectAllTpl: () => void;
  clearTpl: () => void;
  downloadTemplatesZip: (mode: "all" | "selected") => Promise<void>;
  tplBusy: boolean;
  tplMsg: string | null;
  ingestorRow: IngestorRow | null;
  pluginBusy: string | null;
  onUninstall: () => void;
  onClose: () => void;
}) {
  const { plugin: p, templates, selTpl, toggleTpl, selectAllTpl, clearTpl,
    downloadTemplatesZip, tplBusy, tplMsg, ingestorRow, pluginBusy, onUninstall, onClose } = props;
  return (
    <div className="scanners-modal-overlay" onClick={onClose}>
      <div className="scanners-modal" onClick={(e) => e.stopPropagation()}>
        <div className="scanners-modal-head">
          <div className="insp-glyph" style={glyphStyle(statusFor(p))}>
            {p.name[0]?.toUpperCase()}
          </div>
          <div style={{ flex: 1 }}>
            <h3 className="scanners-modal-title">{p.name}</h3>
            <div className="scanner-meta">{p.category || p.type} · v{p.installed_version || p.latest_version}</div>
          </div>
          <button type="button" className="scanners-modal-close" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="scanners-modal-body">
          <p style={{ color: "var(--fg-1)", marginTop: 0 }}>{p.description}</p>
          <div className="scanners-field">
            <label>Source</label>
            <input type="text" readOnly value={p.source_repo || ""} />
          </div>
          {p.binary_path && (
            <div className="scanners-field">
              <label>Binary path</label>
              <input type="text" readOnly value={p.binary_path} />
            </div>
          )}
          {ingestorRow && (
            <div className="scanners-field">
              <label>Formats / hints</label>
              <input type="text" readOnly value={ingestorRow.hints} />
            </div>
          )}

          {templates && templates.length > 0 && (
            <>
              <div style={{ fontSize: "var(--fs-xs)", color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.08em", margin: "var(--sp-4) 0 var(--sp-2)" }}>
                Templates ({templates.length})
              </div>
              <div style={{ display: "flex", gap: 6, marginBottom: "var(--sp-2)", flexWrap: "wrap" }}>
                <button type="button" className="btn primary" disabled={tplBusy} onClick={() => void downloadTemplatesZip("all")}>
                  Download all
                </button>
                <button type="button" className="btn" disabled={tplBusy || selTpl.size === 0} onClick={() => void downloadTemplatesZip("selected")}>
                  Download selected ({selTpl.size})
                </button>
                <button type="button" className="btn ghost" disabled={tplBusy} onClick={selectAllTpl}>Select all</button>
                <button type="button" className="btn ghost" disabled={tplBusy} onClick={clearTpl}>Clear</button>
              </div>
              {tplMsg && <div className="scanners-message">{tplMsg}</div>}
              <ul className="scanners-tpl-list">
                {templates.map((t) => (
                  <li key={t.id} className="scanners-tpl-row">
                    <input
                      type="checkbox"
                      checked={selTpl.has(t.id)}
                      onChange={() => toggleTpl(t.id)}
                    />
                    <span className="scanners-tpl-title">{t.title}</span>
                    <span className="scanners-tpl-id">{t.id}</span>
                    <span className="scanners-tpl-id">{formatBytes(t.size_bytes)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="scanners-modal-foot">
          {(p.installed || p.binary_found) && (
            <button type="button" className="btn danger" disabled={pluginBusy === p.id} onClick={onUninstall}>
              {pluginBusy === p.id ? "Working…" : "Uninstall"}
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function RunModal(props: {
  plugin: PluginInfo;
  targets: string;
  onTargetsChange: (v: string) => void;
  busy: boolean;
  progress: ScanProgress | null;
  message: string | null;
  onRun: () => void;
  onStop: () => void;
  onClose: () => void;
}) {
  const { plugin: p, targets, onTargetsChange, busy, progress, message, onRun, onStop, onClose } = props;
  return (
    <div className="scanners-modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="scanners-modal" onClick={(e) => e.stopPropagation()}>
        <div className="scanners-modal-head">
          <div className="insp-glyph" style={glyphStyle("ready")}>
            {p.name[0]?.toUpperCase()}
          </div>
          <div style={{ flex: 1 }}>
            <h3 className="scanners-modal-title">Run {p.name}</h3>
            <div className="scanner-meta">
              {p.category || p.type} · v{p.installed_version || p.latest_version}
            </div>
          </div>
          <button type="button" className="scanners-modal-close" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="scanners-modal-body">
          <div className="scanners-field">
            <label>Targets (one per line)</label>
            <textarea
              value={targets}
              onChange={(e) => onTargetsChange(e.target.value)}
              rows={6}
              placeholder={"https://example.com\nhttps://target.com"}
              disabled={busy}
            />
          </div>
          {progress && (
            <div className="scanners-progress">
              {progress.phase && <span>{progress.phase}</span>}
              {progress.lines_processed != null && <span>{progress.lines_processed} lines</span>}
              {progress.elapsed_seconds != null && <span>{progress.elapsed_seconds}s elapsed</span>}
            </div>
          )}
          {message && <div className="scanners-message">{message}</div>}
        </div>
        <div className="scanners-modal-foot">
          {busy ? (
            <button type="button" className="btn danger" onClick={onStop}>
              Stop
            </button>
          ) : (
            <button type="button" className="btn" onClick={onClose}>Close</button>
          )}
          <button
            type="button"
            className="btn primary"
            disabled={busy || !targets.trim()}
            onClick={onRun}
          >
            {busy ? "Scanning…" : "Run scan"}
          </button>
        </div>
      </div>
    </div>
  );
}
