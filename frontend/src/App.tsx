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

const UI_DEFAULT: UIPrefs = {
  graph_layout: "cose",
  node_size: 18,
  font_size: 10,
  edge_opacity: 0.65,
  edge_width: 1.5,
  label_max_len: 40,
  wheel_sensitivity: 0.25,
};

type Tab = "graph" | "operations" | "settings" | "ingestors" | "queries" | "data" | "registry";

type SettingsPayload = {
  runtime: { ui: Partial<UIPrefs> };
};

function mergeUi(patch: Partial<UIPrefs>): UIPrefs {
  return { ...UI_DEFAULT, ...patch };
}

export default function App() {
  const [booted, setBooted] = useState(false);
  const [needLogin, setNeedLogin] = useState(true);
  const [tab, setTab] = useState<Tab>("graph");
  const [ui, setUi] = useState<UIPrefs>(UI_DEFAULT);
  const [toast, setToast] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      const s = await apiJson<SettingsPayload>("/api/settings");
      setUi(mergeUi(s.runtime.ui));
    } catch {
      /* keep defaults */
    }
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
          setNeedLogin(false);
          await loadSettings();
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
  }, [loadSettings]);

  const onAuthed = useCallback(() => {
    setNeedLogin(false);
    void loadSettings();
  }, [loadSettings]);

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

  const tabs: { id: Tab; label: string }[] = [
    { id: "graph", label: "Graph" },
    { id: "operations", label: "Ingest & crawl" },
    { id: "settings", label: "Settings" },
    { id: "ingestors", label: "Ingestors" },
    { id: "queries", label: "Queries" },
    { id: "data", label: "Export / import" },
    { id: "registry", label: "Types" },
  ];

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">Gossamer</div>
        <nav className="tabs">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={tab === t.id ? "tab active" : "tab"}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
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
      <main className="main-area">
        {tab === "graph" ? (
          <GraphPanel ui={ui} onUiChange={(p) => setUi((prev) => ({ ...prev, ...p }))} onPersistUi={onPersistUi} />
        ) : null}
        {tab === "operations" ? <OperationsPanel /> : null}
        {tab === "settings" ? <SettingsPanel onRuntimeUpdated={() => void loadSettings()} /> : null}
        {tab === "ingestors" ? <IngestorsPanel /> : null}
        {tab === "queries" ? <QueriesPanel /> : null}
        {tab === "data" ? <DataPanel /> : null}
        {tab === "registry" ? <RegistryPanel /> : null}
      </main>
    </div>
  );
}
