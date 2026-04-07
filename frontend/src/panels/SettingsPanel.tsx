import { FormEvent, useEffect, useState } from "react";
import { apiJson, clearAuth } from "../api";

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

function linesToList(s: string): string[] {
  return s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
}

function formatEnvValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export default function SettingsPanel({ onRuntimeUpdated }: Props) {
  const [full, setFull] = useState<SettingsResponse | null>(null);
  const [corsText, setCorsText] = useState("");
  const [scopeText, setScopeText] = useState("");
  const [normText, setNormText] = useState("");
  const [crawlDepth, setCrawlDepth] = useState("");
  const [crawlPages, setCrawlPages] = useState("");
  const [crawlTimeout, setCrawlTimeout] = useState("");
  const [crawlUa, setCrawlUa] = useState("");
  const [curPw, setCurPw] = useState("");
  const [newUser, setNewUser] = useState("");
  const [newPw, setNewPw] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    try {
      const s = await apiJson<SettingsResponse>("/api/settings");
      setFull(s);
      const eff = s.effective;
      setCorsText(((eff.cors_origins as string[]) || []).join("\n"));
      setScopeText(((eff.scope_hosts as string[]) || []).join("\n"));
      setNormText(((eff.normalizer_order as string[]) || []).join("\n"));
      setCrawlDepth(String(eff.crawl_max_depth ?? ""));
      setCrawlPages(String(eff.crawl_max_pages ?? ""));
      setCrawlTimeout(String(eff.crawl_timeout_seconds ?? ""));
      setCrawlUa(String(eff.crawl_user_agent ?? ""));
      setMsg(null);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function savePipeline(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    const pipeline: Record<string, unknown> = {
      cors_origins: linesToList(corsText),
      scope_hosts: linesToList(scopeText),
      normalizer_order: linesToList(normText),
    };
    if (crawlDepth) pipeline.crawl_max_depth = Number(crawlDepth);
    if (crawlPages) pipeline.crawl_max_pages = Number(crawlPages);
    if (crawlTimeout) pipeline.crawl_timeout_seconds = Number(crawlTimeout);
    if (crawlUa.trim()) pipeline.crawl_user_agent = crawlUa.trim();
    try {
      await apiJson("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipeline }),
      });
      setMsg("Pipeline settings saved.");
      await refresh();
      onRuntimeUpdated();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  async function submitAuth(revert: boolean) {
    setMsg(null);
    if (!curPw.trim()) {
      setMsg("Current password is required.");
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
          setMsg("Enter a new username and/or new password, or use Revert.");
          return;
        }
      }
      const r = await apiJson<{ message?: string }>("/api/settings/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setMsg(r.message ?? "Credentials updated.");
      setCurPw("");
      setNewUser("");
      setNewPw("");
      clearAuth();
      await refresh();
      onRuntimeUpdated();
      window.alert(
        "Session cleared. Sign in again with the new credentials (or README defaults if you reverted).",
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  const envRows = full?.env ? Object.entries(full.env).sort(([a], [b]) => a.localeCompare(b)) : [];

  return (
    <div className="panel-block">
      <div className="card">
        <h2>Environment-backed settings</h2>
        <p className="muted">
          Values come from <code>GOSSAMER_*</code> (process environment). Restart the API after changing env vars.
          Password values are never shown; runtime overrides are stored under <code>data/config/runtime.json</code>{" "}
          (see Credentials below).
        </p>
        {full ? (
          <div className="settings-table-wrap">
            <table className="settings-table">
              <thead>
                <tr>
                  <th>Variable field</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {envRows.map(([k, v]) => (
                  <tr key={k}>
                    <td>
                      <code>{k}</code>
                    </td>
                    <td className="env-val">{formatEnvValue(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <h2>Paths</h2>
        {full ? (
          <div className="env-paths">
            <div>
              <strong>DB</strong> <code>{full.env_paths.database_path}</code>
            </div>
            <div>
              <strong>Uploads</strong> <code>{full.env_paths.uploads_dir}</code>
            </div>
            <div>
              <strong>Exports</strong> <code>{full.env_paths.exports_dir}</code>
            </div>
          </div>
        ) : null}

        {full?.notes?.map((n) => (
          <p key={n} className="muted">
            {n}
          </p>
        ))}
      </div>

      <div className="card">
        <h2>Credentials (runtime override)</h2>
        {full?.auth?.auth_disabled ? (
          <p className="muted">HTTP Basic auth is disabled for this process.</p>
        ) : (
          <>
            <p className="muted">
              Effective login user: <strong>{full?.auth?.effective_username ?? "\u2014"}</strong>
              {full?.auth?.runtime_override_active ? " (runtime override active)" : " (from environment defaults)"}
            </p>
            <form
              className="form-grid"
              onSubmit={(e) => {
                e.preventDefault();
                void submitAuth(false);
              }}
            >
              <label className="full">
                Current password
                <input type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} autoComplete="off" />
              </label>
              <label className="full">
                New username (optional)
                <input value={newUser} onChange={(e) => setNewUser(e.target.value)} autoComplete="off" />
              </label>
              <label className="full">
                New password (optional)
                <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" />
              </label>
              <div className="form-actions">
                <button type="submit" className="primary">
                  Apply new credentials
                </button>
                <button type="button" className="danger" onClick={() => void submitAuth(true)}>
                  Revert to environment only
                </button>
              </div>
            </form>
            <p className="muted">
              Revert clears the saved override so login uses <code>GOSSAMER_AUTH_USERNAME</code> /{" "}
              <code>GOSSAMER_AUTH_PASSWORD</code> again.
            </p>
          </>
        )}
      </div>

      <div className="card">
        <h2>Pipeline (saved in runtime file)</h2>
        <form onSubmit={savePipeline} className="form-grid">
          <label className="full">
            CORS origins (one per line)
            <textarea value={corsText} onChange={(e) => setCorsText(e.target.value)} rows={3} />
          </label>
          <label className="full">
            Default crawl scope hosts (one per line)
            <textarea value={scopeText} onChange={(e) => setScopeText(e.target.value)} rows={3} />
          </label>
          <label className="full">
            Normalizer order (one per line)
            <textarea value={normText} onChange={(e) => setNormText(e.target.value)} rows={4} />
          </label>
          <label>
            Crawl max depth
            <input value={crawlDepth} onChange={(e) => setCrawlDepth(e.target.value)} />
          </label>
          <label>
            Crawl max pages
            <input value={crawlPages} onChange={(e) => setCrawlPages(e.target.value)} />
          </label>
          <label>
            Crawl timeout (seconds)
            <input value={crawlTimeout} onChange={(e) => setCrawlTimeout(e.target.value)} />
          </label>
          <label className="full">
            Crawler user-agent
            <input value={crawlUa} onChange={(e) => setCrawlUa(e.target.value)} />
          </label>
          <div className="form-actions">
            <button type="submit">Save pipeline settings</button>
            <button type="button" onClick={() => void refresh()}>
              Reload
            </button>
          </div>
        </form>
      </div>

      {full ? (
        <div className="card">
          <details className="raw-settings">
            <summary>Runtime JSON snapshot (secrets masked)</summary>
            <pre>{JSON.stringify(full.runtime, null, 2)}</pre>
          </details>
        </div>
      ) : null}

      {msg ? <pre className="panel-msg">{msg}</pre> : null}
    </div>
  );
}
