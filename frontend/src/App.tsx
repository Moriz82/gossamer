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
import FindingsPanel from "./panels/FindingsPanel";
import ScannersPanel from "./panels/ScannersPanel";
import SitemapPanel from "./panels/SitemapPanel";
import IntelPanel from "./panels/IntelPanel";
import Shell, { type Tab, type Project } from "./components/Shell";
import CommandPalette from "./components/CommandPalette";
import { Toast } from "./components/Primitives";
import TweaksPanel, { TWEAK_DEFAULTS, type TweaksState } from "./components/TweaksPanel";

const UI_DEFAULT: UIPrefs = {
  graph_layout: "cose",
  node_size: 18,
  font_size: 10,
  edge_opacity: 0.65,
  edge_width: 1.5,
  label_max_len: 40,
  wheel_sensitivity: 0.25,
};

type GraphStats = { total_nodes: number; total_edges: number };

type SettingsPayload = {
  runtime: { ui: Partial<UIPrefs> };
};

function mergeUi(patch: Partial<UIPrefs>): UIPrefs {
  return { ...UI_DEFAULT, ...patch };
}

const VALID_TABS: Tab[] = [
  "graph",
  "sitemap",
  "intel",
  "operations",
  "scanners",
  "findings",
  "settings",
  "ingestors",
  "queries",
  "registry",
  "data",
];

const TAB_STORAGE_KEY = "gossamer.tab";

function readPersistedTab(): Tab {
  try {
    const raw = localStorage.getItem(TAB_STORAGE_KEY);
    if (raw && (VALID_TABS as string[]).includes(raw)) return raw as Tab;
  } catch {
    /* ignore */
  }
  return "graph";
}

export default function App() {
  const [booted, setBooted] = useState(false);
  const [needLogin, setNeedLogin] = useState(true);
  const [tab, setTabState] = useState<Tab>(() => readPersistedTab());
  const [ui, setUi] = useState<UIPrefs>(UI_DEFAULT);
  const [toast, setToast] = useState<string | null>(null);
  const [graphStats, setGraphStats] = useState<GraphStats | null>(null);
  const [backendType, setBackendType] = useState<string>("sqlite");
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState("default");
  const [projectBusy, setProjectBusy] = useState(false);
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [tweaks, setTweaks] = useState<TweaksState>(() => ({ ...TWEAK_DEFAULTS }));
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [editModeActive, setEditModeActive] = useState(false);

  const setTab = useCallback((next: Tab) => {
    setTabState(next);
    try {
      localStorage.setItem(TAB_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

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
    apiJson<Project[]>("/api/projects").then(setProjects).catch(() => {});
  }, []);

  const createProject = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      setProjectBusy(true);
      try {
        await apiJson("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed }),
        });
        loadProjects();
      } catch (e) {
        setToast(e instanceof Error ? e.message : String(e));
      } finally {
        setProjectBusy(false);
      }
    },
    [loadProjects],
  );

  const switchProject = useCallback(
    async (name: string) => {
      setProjectBusy(true);
      try {
        await apiJson(`/api/projects/${name}/activate`, { method: "POST" });
        setActiveProject(name);
        loadGraphStats();
      } catch (e) {
        setToast(e instanceof Error ? e.message : String(e));
      } finally {
        setProjectBusy(false);
      }
    },
    [loadGraphStats],
  );

  const deleteProject = useCallback(
    async (name: string) => {
      if (!confirm(`Delete project "${name}" and all its data?`)) return;
      setProjectBusy(true);
      try {
        await apiJson(`/api/projects/${name}`, { method: "DELETE" });
        loadProjects();
      } catch (e) {
        setToast(e instanceof Error ? e.message : String(e));
      } finally {
        setProjectBusy(false);
      }
    },
    [loadProjects],
  );

  const exportProject = useCallback(async (name: string) => {
    setProjectBusy(true);
    try {
      const r = await apiJson<{ ok: boolean; path: string }>("/api/projects/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, format: "zip" }),
      });
      setToast(`Exported to ${r.path}`);
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    } finally {
      setProjectBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    let cancelled = false;
    const finishBoot = () => {
      if (!cancelled) setBooted(true);
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
        if (!cancelled) setNeedLogin(true);
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
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    }
  }, [ui]);

  useEffect(() => {
    const r = document.documentElement;
    r.style.setProperty("--accent-hue", String(tweaks.accentHue));
    r.dataset.density = tweaks.density;
    r.style.setProperty("--ff-mono", `'${tweaks.mono}', ui-monospace, monospace`);
  }, [tweaks]);

  const setTweak = useCallback(
    <K extends keyof TweaksState>(key: K, value: TweaksState[K]) => {
      setTweaks((prev) => {
        const next = { ...prev, [key]: value };
        try {
          window.parent?.postMessage(
            { type: "__edit_mode_set_keys", edits: { [key]: value } },
            "*",
          );
        } catch {
          /* ignore cross-origin */
        }
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const data = e.data as { type?: string } | undefined;
      if (!data) return;
      if (data.type === "__activate_edit_mode") {
        setEditModeActive(true);
        setTweaksOpen(true);
      }
      if (data.type === "__deactivate_edit_mode") {
        setEditModeActive(false);
        setTweaksOpen(false);
      }
    };
    window.addEventListener("message", handler);
    try {
      window.parent?.postMessage({ type: "__edit_mode_available" }, "*");
    } catch {
      /* ignore */
    }
    return () => window.removeEventListener("message", handler);
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdkOpen(true);
        return;
      }
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || t?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const map: Record<string, Tab> = {
        g: "graph",
        s: "sitemap",
        i: "intel",
        o: "operations",
        n: "scanners",
        f: "findings",
        ",": "settings",
      };
      const target = map[e.key];
      if (target) {
        e.preventDefault();
        setTab(target);
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        setCmdkOpen(true);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [setTab]);

  const onLogout = useCallback(() => {
    clearAuth();
    setNeedLogin(true);
  }, []);

  if (!booted) {
    return <div className="boot-screen">Loading…</div>;
  }

  if (needLogin) {
    return <LoginGate onAuthed={onAuthed} />;
  }

  const nodeCount = graphStats?.total_nodes ?? 0;

  return (
    <>
      <Shell
        tab={tab}
        setTab={setTab}
        graphStats={{ nodes: nodeCount }}
        onOpenCmdk={() => setCmdkOpen(true)}
        onLogout={onLogout}
        projects={projects}
        activeProject={activeProject}
        onSwitchProject={(n) => void switchProject(n)}
        onCreateProject={(n) => void createProject(n)}
        onDeleteProject={(n) => void deleteProject(n)}
        onExportProject={(n) => void exportProject(n)}
        onReloadProjects={loadProjects}
        projectBusy={projectBusy}
      >
        {tab === "graph" && (
          <GraphPanel
            ui={ui}
            onUiChange={(p) => setUi((prev) => ({ ...prev, ...p }))}
            onPersistUi={onPersistUi}
            backendType={backendType}
          />
        )}
        {tab === "operations" && <OperationsPanel />}
        {tab === "settings" && <SettingsPanel onRuntimeUpdated={() => void loadSettings()} />}
        {tab === "ingestors" && <IngestorsPanel />}
        {tab === "queries" && <QueriesPanel />}
        {tab === "intel" && <IntelPanel />}
        {tab === "sitemap" && <SitemapPanel />}
        {tab === "scanners" && <ScannersPanel />}
        {tab === "data" && <DataPanel />}
        {tab === "registry" && <RegistryPanel />}
        {tab === "findings" && <FindingsPanel />}
      </Shell>

      <CommandPalette
        open={cmdkOpen}
        onClose={() => setCmdkOpen(false)}
        onNavigate={(t) => {
          if ((VALID_TABS as string[]).includes(t)) setTab(t as Tab);
        }}
      />

      <Toast msg={toast} />

      {editModeActive && tweaksOpen && (
        <TweaksPanel
          tweaks={tweaks}
          setTweak={setTweak}
          onClose={() => setTweaksOpen(false)}
        />
      )}
    </>
  );
}
