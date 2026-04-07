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
  }, [loadSettings, loadGraphStats]);

  const onAuthed = useCallback(() => {
    setNeedLogin(false);
    void loadSettings();
    loadGraphStats();
  }, [loadSettings, loadGraphStats]);

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
          <GraphPanel ui={ui} onUiChange={(p) => setUi((prev) => ({ ...prev, ...p }))} onPersistUi={onPersistUi} />
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
