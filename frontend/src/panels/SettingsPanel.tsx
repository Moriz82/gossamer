import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, apiJson, clearAuth } from "../api";

type AuthInfo = {
  effective_username?: string;
  env_username?: string;
  runtime_override_active?: boolean;
  auth_disabled?: boolean;
};

type SettingsResponse = {
  effective: Record<string, unknown>;
  runtime: Record<string, unknown>;
  env_paths: Record<string, string>;
  env: Record<string, unknown>;
  notes: string[];
  auth?: AuthInfo;
};

type Props = {
  onRuntimeUpdated: () => void;
};

/** Normalizer steps that the panel surfaces as individual toggles. Kept in sync
 *  with backend's default `normalizer_order`. Any value present in the saved
 *  list that is not in this catalogue is preserved as-is. */
const NORMALIZER_STEPS: Array<{ key: string; label: string }> = [
  { key: "lowercase_host", label: "lowercase_host" },
  { key: "strip_default_port", label: "strip_default_port" },
  { key: "collapse_trailing_slash", label: "collapse_trailing_slash" },
  { key: "strip_utm", label: "strip_utm" },
  { key: "sort_query", label: "sort_query" },
  { key: "strip_fragment", label: "strip_fragment" },
];

function linesToList(s: string): string[] {
  return s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

async function patchSettings(patch: Record<string, unknown>): Promise<void> {
  const r = await apiFetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || r.statusText);
  }
}

export default function SettingsPanel({ onRuntimeUpdated }: Props) {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // editable input buffers
  const [corsText, setCorsText] = useState("");
  const [scopeText, setScopeText] = useState("");
  const [crawlDepth, setCrawlDepth] = useState("");
  const [crawlPages, setCrawlPages] = useState("");
  const [crawlTimeout, setCrawlTimeout] = useState("");
  const [crawlUa, setCrawlUa] = useState("");

  // credentials form
  const [showAuth, setShowAuth] = useState(false);
  const [curPw, setCurPw] = useState("");
  const [newUser, setNewUser] = useState("");
  const [newPw, setNewPw] = useState("");

  const refresh = useCallback(async () => {
    try {
      const s = await apiJson<SettingsResponse>("/api/settings");
      setData(s);
      const eff = s.effective;
      setCorsText(((eff.cors_origins as string[]) || []).join("\n"));
      setScopeText(((eff.scope_hosts as string[]) || []).join("\n"));
      setCrawlDepth(String(eff.crawl_max_depth ?? ""));
      setCrawlPages(String(eff.crawl_max_pages ?? ""));
      setCrawlTimeout(String(eff.crawl_timeout_seconds ?? ""));
      setCrawlUa(String(eff.crawl_user_agent ?? ""));
    } catch (e) {
      setFlash({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const eff = data?.effective ?? {};
  const ui = (eff.ui as Record<string, unknown>) ?? {};
  const currentOrder = useMemo(
    () => ((eff.normalizer_order as string[]) || []),
    [eff.normalizer_order],
  );
  const enabledSet = useMemo(() => new Set(currentOrder), [currentOrder]);

  /** Toggle a normalizer step on/off — PATCH runs immediately (optimistic). */
  const toggleNormalizer = useCallback(
    async (key: string) => {
      const present = enabledSet.has(key);
      const next = present
        ? currentOrder.filter((k) => k !== key)
        : [...currentOrder, key];
      // Optimistic UI
      setData((prev) =>
        prev
          ? { ...prev, effective: { ...prev.effective, normalizer_order: next } }
          : prev,
      );
      try {
        await patchSettings({ pipeline: { normalizer_order: next } });
        setFlash({ kind: "ok", text: `normalizer.${key} ${present ? "disabled" : "enabled"}` });
        onRuntimeUpdated();
        void refresh();
      } catch (e) {
        setFlash({ kind: "err", text: e instanceof Error ? e.message : String(e) });
        void refresh();
      }
    },
    [currentOrder, enabledSet, onRuntimeUpdated, refresh],
  );

  async function savePipeline(e: FormEvent) {
    e.preventDefault();
    setFlash(null);
    const pipeline: Record<string, unknown> = {
      cors_origins: linesToList(corsText),
      scope_hosts: linesToList(scopeText),
    };
    if (crawlDepth) pipeline.crawl_max_depth = Number(crawlDepth);
    if (crawlPages) pipeline.crawl_max_pages = Number(crawlPages);
    if (crawlTimeout) pipeline.crawl_timeout_seconds = Number(crawlTimeout);
    if (crawlUa.trim()) pipeline.crawl_user_agent = crawlUa.trim();
    try {
      await patchSettings({ pipeline });
      setFlash({ kind: "ok", text: "Pipeline settings saved." });
      await refresh();
      onRuntimeUpdated();
    } catch (err) {
      setFlash({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    }
  }

  async function submitAuth(revert: boolean) {
    setFlash(null);
    if (!curPw.trim()) {
      setFlash({ kind: "err", text: "Current password is required." });
      return;
    }
    try {
      const body: Record<string, unknown> = {
        current_password: curPw,
        revert_to_environment: revert,
      };
      if (!revert) {
        if (newUser.trim()) body.new_username = newUser.trim();
        if (newPw) body.new_password = newPw;
        if (!newUser.trim() && !newPw) {
          setFlash({ kind: "err", text: "Enter a new username and/or new password, or use Revert." });
          return;
        }
      }
      const r = await apiJson<{ message?: string }>("/api/settings/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setFlash({ kind: "ok", text: r.message ?? "Credentials updated." });
      setCurPw("");
      setNewUser("");
      setNewPw("");
      setShowAuth(false);
      clearAuth();
      await refresh();
      onRuntimeUpdated();
      window.alert(
        "Session cleared. Sign in again with the new credentials (or README defaults if you reverted).",
      );
    } catch (err) {
      setFlash({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    }
  }

  const envRows = useMemo(
    () =>
      data?.env
        ? Object.entries(data.env).sort(([a], [b]) => a.localeCompare(b))
        : [],
    [data?.env],
  );

  return (
    <div className="screen settings-screen">
      <div className="screen-header">
        <h1 className="screen-title">Settings</h1>
        <span className="screen-sub">
          {data?.auth?.auth_disabled ? "auth disabled" : `signed in as ${data?.auth?.effective_username ?? "—"}`}
        </span>
        <div className="settings-header-spacer" />
        <button type="button" className="settings-btn" onClick={() => void refresh()}>
          Reload
        </button>
      </div>

      <div className="screen-body">
        {flash ? (
          <div className={`settings-flash${flash.kind === "err" ? " error" : ""}`}>
            {flash.text}
          </div>
        ) : null}

        {/* ---------------- Credentials ---------------- */}
        <section className="settings-section">
          <div className="settings-section-label">Credentials</div>
          <div className="settings-card">
            <div className="settings-row">
              <div className="settings-row-label">
                API user
                <span className="settings-row-hint">
                  {data?.auth?.runtime_override_active
                    ? "runtime override active"
                    : "from GOSSAMER_AUTH_USERNAME"}
                </span>
              </div>
              <span className="settings-row-value">
                {data?.auth?.effective_username ?? "—"}
              </span>
            </div>
            <div className="settings-row">
              <div className="settings-row-label">
                Rotate password
                <span className="settings-row-hint">
                  Update runtime credentials (stored beside DB, masked).
                </span>
              </div>
              <button
                type="button"
                className="settings-btn"
                onClick={() => setShowAuth((s) => !s)}
                disabled={data?.auth?.auth_disabled}
              >
                {showAuth ? "Cancel" : "Set new password"}
              </button>
            </div>
            {showAuth && !data?.auth?.auth_disabled ? (
              <div className="settings-row-stack">
                <div className="settings-row-stack-field">
                  <input
                    type="password"
                    placeholder="Current password"
                    value={curPw}
                    onChange={(e) => setCurPw(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div className="settings-row-stack-field">
                  <input
                    placeholder="New username (optional)"
                    value={newUser}
                    onChange={(e) => setNewUser(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div className="settings-row-stack-field">
                  <input
                    type="password"
                    placeholder="New password (optional)"
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
                <div className="settings-row-stack-actions">
                  <button
                    type="button"
                    className="settings-btn danger"
                    onClick={() => void submitAuth(true)}
                  >
                    Revert to env
                  </button>
                  <button
                    type="button"
                    className="settings-btn primary"
                    onClick={() => void submitAuth(false)}
                  >
                    Apply
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        {/* ---------------- Storage ---------------- */}
        <section className="settings-section">
          <div className="settings-section-label">Storage</div>
          <div className="settings-card">
            <div className="settings-row">
              <div className="settings-row-label">Database path</div>
              <span className="settings-row-value" title={data?.env_paths?.database_path}>
                {formatVal(data?.env_paths?.database_path)}
              </span>
            </div>
            <div className="settings-row">
              <div className="settings-row-label">Uploads dir</div>
              <span className="settings-row-value" title={data?.env_paths?.uploads_dir}>
                {formatVal(data?.env_paths?.uploads_dir)}
              </span>
            </div>
            <div className="settings-row">
              <div className="settings-row-label">Exports dir</div>
              <span className="settings-row-value" title={data?.env_paths?.exports_dir}>
                {formatVal(data?.env_paths?.exports_dir)}
              </span>
            </div>
          </div>
        </section>

        {/* ---------------- Normalization ---------------- */}
        <section className="settings-section">
          <div className="settings-section-label">Normalization</div>
          <div className="settings-card">
            {NORMALIZER_STEPS.map((step) => {
              const on = enabledSet.has(step.key);
              return (
                <div className="settings-row" key={step.key}>
                  <div className="settings-row-label">{step.label}</div>
                  <button
                    type="button"
                    className={`settings-toggle${on ? " on" : ""}`}
                    aria-pressed={on}
                    aria-label={`${step.label} ${on ? "enabled" : "disabled"}`}
                    onClick={() => void toggleNormalizer(step.key)}
                  >
                    <span className="settings-toggle-knob" />
                  </button>
                </div>
              );
            })}
            {/* Surface any custom entries the user added outside the catalogue */}
            {currentOrder
              .filter((k) => !NORMALIZER_STEPS.some((s) => s.key === k))
              .map((k) => (
                <div className="settings-row" key={`extra-${k}`}>
                  <div className="settings-row-label">
                    {k}
                    <span className="settings-row-hint">custom</span>
                  </div>
                  <button
                    type="button"
                    className="settings-toggle on"
                    aria-pressed
                    onClick={() => void toggleNormalizer(k)}
                  >
                    <span className="settings-toggle-knob" />
                  </button>
                </div>
              ))}
          </div>
        </section>

        {/* ---------------- Pipeline (lists + crawl limits) ---------------- */}
        <section className="settings-section">
          <div className="settings-section-label">Pipeline</div>
          <form className="settings-card" onSubmit={savePipeline}>
            <div className="settings-row-stack">
              <div className="settings-row-stack-header">
                <div className="settings-row-stack-header-label">CORS origins</div>
              </div>
              <div className="settings-row-stack-field">
                <textarea
                  value={corsText}
                  onChange={(e) => setCorsText(e.target.value)}
                  rows={3}
                  placeholder="https://app.example.com"
                />
              </div>
              <div className="settings-row-stack-hint">One origin per line.</div>
            </div>

            <div className="settings-row-stack">
              <div className="settings-row-stack-header">
                <div className="settings-row-stack-header-label">Default crawl scope hosts</div>
              </div>
              <div className="settings-row-stack-field">
                <textarea
                  value={scopeText}
                  onChange={(e) => setScopeText(e.target.value)}
                  rows={3}
                  placeholder="example.com"
                />
              </div>
              <div className="settings-row-stack-hint">One host per line.</div>
            </div>

            <div className="settings-row">
              <div className="settings-row-label">Crawl max depth</div>
              <div className="settings-row-stack-field narrow">
                <input value={crawlDepth} onChange={(e) => setCrawlDepth(e.target.value)} inputMode="numeric" />
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-row-label">Crawl max pages</div>
              <div className="settings-row-stack-field narrow">
                <input value={crawlPages} onChange={(e) => setCrawlPages(e.target.value)} inputMode="numeric" />
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-row-label">Crawl timeout (s)</div>
              <div className="settings-row-stack-field narrow">
                <input value={crawlTimeout} onChange={(e) => setCrawlTimeout(e.target.value)} inputMode="decimal" />
              </div>
            </div>
            <div className="settings-row-stack">
              <div className="settings-row-stack-header">
                <div className="settings-row-stack-header-label">Crawler user-agent</div>
              </div>
              <div className="settings-row-stack-field">
                <input value={crawlUa} onChange={(e) => setCrawlUa(e.target.value)} />
              </div>
            </div>

            <div className="settings-row-stack">
              <div className="settings-row-stack-actions">
                <button type="button" className="settings-btn" onClick={() => void refresh()}>
                  Reset
                </button>
                <button type="submit" className="settings-btn primary">
                  Save pipeline
                </button>
              </div>
            </div>
          </form>
        </section>

        {/* ---------------- UI preferences (read-only summary) ---------------- */}
        <section className="settings-section">
          <div className="settings-section-label">UI preferences</div>
          <div className="settings-card">
            {[
              ["graph_layout", "Graph layout"],
              ["node_size", "Node size"],
              ["font_size", "Label font"],
              ["edge_opacity", "Edge opacity"],
              ["edge_width", "Edge width"],
              ["label_max_len", "Label max length"],
              ["wheel_sensitivity", "Wheel sensitivity"],
            ].map(([key, label]) => (
              <div className="settings-row" key={key}>
                <div className="settings-row-label">
                  {label}
                  <span className="settings-row-hint">
                    Adjust from the Graph panel sidebar.
                  </span>
                </div>
                <span className="settings-row-value">{formatVal(ui[key])}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------- Environment (read-only) ---------------- */}
        <section className="settings-section">
          <div className="settings-section-label">Environment</div>
          <div className="settings-card">
            {envRows.length === 0 ? (
              <div className="settings-row">
                <div className="settings-row-label">No environment overrides reported.</div>
              </div>
            ) : (
              envRows.map(([k, v]) => (
                <div className="settings-row" key={k}>
                  <div className="settings-row-label mono">{k}</div>
                  <span className="settings-row-value" title={formatVal(v)}>
                    {formatVal(v)}
                  </span>
                </div>
              ))
            )}
          </div>
          {data?.notes?.length ? (
            <div className="settings-notes">
              {data.notes.map((n) => (
                <div key={n}>{n}</div>
              ))}
            </div>
          ) : null}
        </section>

        {/* ---------------- Raw runtime snapshot ---------------- */}
        {data ? (
          <details className="settings-raw">
            <summary>Runtime JSON snapshot (secrets masked)</summary>
            <pre>{JSON.stringify(data.runtime, null, 2)}</pre>
          </details>
        ) : null}
      </div>
    </div>
  );
}
