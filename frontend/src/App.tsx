import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiJson, clearAuth, isAuthStored } from "./api";
import LoginGate from "./LoginGate";
import GraphPanel, { type UIPrefs } from "./panels/GraphPanel";
import OperationsPanel from "./panels/OperationsPanel";
import SettingsPanel from "./panels/SettingsPanel";
import QueriesPanel from "./panels/QueriesPanel";
import DataPanel from "./panels/DataPanel";
import RegistryPanel from "./panels/RegistryPanel";
import IngestorsPanel from "./panels/IngestorsPanel";
import VulnsPanel from "./panels/VulnsPanel";
import ScannersPanel from "./panels/ScannersPanel";

const UI_DEFAULT: UIPrefs = {
  graph_layout: "cose",
  node_size: 18,
  font_size: 10,
  edge_opacity: 0.65,
  edge_width: 1.5,
  label_max_len: 40,
  wheel_sensitivity: 0.25,
};

type Tab =
  | "graph"
  | "operations"
  | "settings"
  | "ingestors"
  | "queries"
  | "vulns"
  | "scanners"
  | "data"
  | "registry";

type GraphStats = { total_nodes: number; total_edges: number };

type SettingsPayload = {
  runtime: { ui: Partial<UIPrefs> };
};

function mergeUi(patch: Partial<UIPrefs>): UIPrefs {
  return { ...UI_DEFAULT, ...patch };
}

const tabGroups = [
  {
    label: "Explore",
    tabs: [
      { id: "graph", label: "Graph" },
      { id: "vulns", label: "Vulns" },
    ],
  },
  {
    label: "Operations",
    tabs: [
      { id: "operations", label: "Ingest & Crawl" },
      { id: "scanners", label: "Scanners" },
    ],
  },
  {
    label: "Configure",
    tabs: [
      { id: "settings", label: "Settings" },
      { id: "ingestors", label: "Ingestors" },
      { id: "registry", label: "Types" },
      { id: "queries", label: "Queries" },
      { id: "data", label: "Data" },
    ],
  },
] as const;

export default function App() {
  const [booted, setBooted] = useState(false);
  const [needLogin, setNeedLogin] = useState(true);
  const [tab, setTab] = useState<Tab>("graph");
  const [ui, setUi] = useState<UIPrefs>(UI_DEFAULT);
  const [toast, setToast] = useState<string | null>(null);
  const [graphStats, setGraphStats] = useState<GraphStats | null>(null);
  const [backendType, setBackendType] = useState<string>("sqlite");
  const [projects, setProjects] = useState<{name: string; created_at: string; has_database: boolean; size_bytes: number}[]>([]);
  const [activeProject, setActiveProject] = useState("default");
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [projectBusy, setProjectBusy] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      const s = await apiJson<SettingsPayload>("/api/settings");
      setUi(mergeUi(s.runtime.ui));
    } catch {
      /* keep defaults */
    }
  }, []);

  const loadGraphStats = useCallback(() => {
    apiJson<GraphStats>("/api/graph/stats").then(setGraphStats).catch(() => {});
  }, []);

  const loadProjects = useCallback(() => {
    apiJson<{name: string; created_at: string; has_database: boolean; size_bytes: number}[]>("/api/projects")
      .then(setProjects).catch(() => {});
  }, []);

  const createProject = useCallback(async () => {
    if (!newProjectName.trim()) return;
    setProjectBusy(true);
    try {
      await apiJson("/api/projects", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newProjectName.trim() }),
      });
      setNewProjectName("");
      loadProjects();
    } catch (e) { setToast(e instanceof Error ? e.message : String(e)); }
    finally { setProjectBusy(false); }
  }, [newProjectName, loadProjects]);

  const switchProject = useCallback(async (name: string) => {
    setProjectBusy(true);
    try {
      await apiJson(`/api/projects/${name}/activate`, { method: "POST" });
      setActiveProject(name);
      setShowProjectMenu(false);
      loadGraphStats();
    } catch (e) { setToast(e instanceof Error ? e.message : String(e)); }
    finally { setProjectBusy(false); }
  }, [loadGraphStats]);

  const deleteProject = useCallback(async (name: string) => {
    if (!confirm(`Delete project "${name}" and all its data?`)) return;
    setProjectBusy(true);
    try {
      await apiJson(`/api/projects/${name}`, { method: "DELETE" });
      loadProjects();
    } catch (e) { setToast(e instanceof Error ? e.message : String(e)); }
    finally { setProjectBusy(false); }
  }, [loadProjects]);

  const exportProject = useCallback(async (name: string) => {
    setProjectBusy(true);
    try {
      const r = await apiJson<{ok: boolean; path: string}>("/api/projects/export", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, format: "zip" }),
      });
      setToast(`Exported to ${r.path}`);
    } catch (e) { setToast(e instanceof Error ? e.message : String(e)); }
    finally { setProjectBusy(false); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const finishBoot = () => {
      if (!cancelled) {
        setBooted(true);
      }
    };

    if (!isAuthStored()) {
      setNeedLogin(true);
      finishBoot();
      return () => {
        cancelled = true;
      };
    }

    const ac = new AbortController();
    const timer = window.setTimeout(() => ac.abort(), 12_000);

    void apiFetch("/api/health", { signal: ac.signal })
      .then(async (r) => {
        if (cancelled) return;
        if (r.ok) {
          const h = await r.json();
          setBackendType(h.backend || "sqlite");
          setNeedLogin(false);
          await loadSettings();
          loadGraphStats();
          loadProjects();
        } else {
          setNeedLogin(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNeedLogin(true);
        }
      })
      .finally(() => {
        window.clearTimeout(timer);
        finishBoot();
      });

    return () => {
      cancelled = true;
      ac.abort();
      window.clearTimeout(timer);
    };
  }, [loadSettings, loadGraphStats, loadProjects]);

  const onAuthed = useCallback(() => {
    setNeedLogin(false);
    void loadSettings();
    loadGraphStats();
    loadProjects();
  }, [loadSettings, loadGraphStats, loadProjects]);

  const onPersistUi = useCallback(async () => {
    try {
      const r = await apiFetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ui }),
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(t || r.statusText);
      }
      setToast("Saved UI preferences.");
      setTimeout(() => setToast(null), 2500);
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    }
  }, [ui]);

  useEffect(() => {
    if (!showProjectMenu) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".project-selector")) setShowProjectMenu(false);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [showProjectMenu]);

  if (!booted) {
    return <div className="boot-screen">Loading…</div>;
  }

  if (needLogin) {
    return <LoginGate onAuthed={onAuthed} />;
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <svg className="brand-logo" viewBox="0 0 32 32" width="24" height="24">
            <g stroke="currentColor" strokeWidth="0.6" opacity="0.6">
              <line x1="16" y1="16" x2="16" y2="1"/>
              <line x1="16" y1="16" x2="29" y2="5"/>
              <line x1="16" y1="16" x2="31" y2="16"/>
              <line x1="16" y1="16" x2="29" y2="27"/>
              <line x1="16" y1="16" x2="16" y2="31"/>
              <line x1="16" y1="16" x2="3" y2="27"/>
              <line x1="16" y1="16" x2="1" y2="16"/>
              <line x1="16" y1="16" x2="3" y2="5"/>
            </g>
            <g fill="none" stroke="currentColor" strokeWidth="0.4" opacity="0.35">
              <circle cx="16" cy="16" r="5"/>
              <circle cx="16" cy="16" r="10"/>
              <circle cx="16" cy="16" r="14"/>
            </g>
            <circle cx="16" cy="16" r="2" fill="currentColor" opacity="0.8"/>
          </svg>
          Gossamer
        </div>
        <div className="project-selector">
          <button type="button" className="project-selector-btn" onClick={() => { setShowProjectMenu(!showProjectMenu); if (!showProjectMenu) loadProjects(); }}>
            {activeProject}
            <span className="project-chevron">&#9662;</span>
          </button>
          {showProjectMenu && (
            <div className="project-menu">
              <div className="project-menu-header">Projects</div>
              {projects.map(p => (
                <div key={p.name} className={`project-menu-item ${p.name === activeProject ? "active" : ""}`}>
                  <button type="button" className="project-menu-name" onClick={() => void switchProject(p.name)} disabled={projectBusy}>
                    {p.name}
                    {p.name === activeProject && <span className="project-active-dot" />}
                  </button>
                  <div className="project-menu-actions">
                    <button type="button" className="ghost" onClick={() => void exportProject(p.name)} disabled={projectBusy} title="Export">&darr;</button>
                    {p.name !== "default" && (
                      <button type="button" className="ghost" onClick={() => void deleteProject(p.name)} disabled={projectBusy} title="Delete">&times;</button>
                    )}
                  </div>
                </div>
              ))}
              <div className="project-menu-create">
                <input type="text" placeholder="New project name" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void createProject(); }} />
                <button type="button" className="primary" onClick={() => void createProject()} disabled={projectBusy || !newProjectName.trim()}>Create</button>
              </div>
            </div>
          )}
        </div>
        <nav className="nav-groups">
          {tabGroups.map((group) => (
            <div key={group.label} className="nav-group">
              <span className="nav-group-label">{group.label}</span>
              <div className="nav-group-tabs">
                {group.tabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={tab === t.id ? "tab active" : "tab"}
                    onClick={() => setTab(t.id as Tab)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="header-status">
          <span className="badge badge-silk">{backendType}</span>
          {graphStats && (
            <span className="badge">{graphStats.total_nodes} nodes</span>
          )}
          <span className="status-dot green" />
        </div>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            clearAuth();
            setNeedLogin(true);
          }}
        >
          Sign out
        </button>
      </header>
      {toast ? <div className="toast">{toast}</div> : null}
      <main className="main-area panel-enter">
        {tab === "graph" ? (
          <GraphPanel ui={ui} onUiChange={(p) => setUi((prev) => ({ ...prev, ...p }))} onPersistUi={onPersistUi} backendType={backendType} />
        ) : null}
        {tab === "operations" ? <OperationsPanel /> : null}
        {tab === "settings" ? <SettingsPanel onRuntimeUpdated={() => void loadSettings()} /> : null}
        {tab === "ingestors" ? <IngestorsPanel /> : null}
        {tab === "queries" ? <QueriesPanel /> : null}
        {tab === "vulns" ? <VulnsPanel /> : null}
        {tab === "scanners" ? <ScannersPanel /> : null}
        {tab === "data" ? <DataPanel /> : null}
        {tab === "registry" ? <RegistryPanel /> : null}
      </main>
    </div>
  );
}
