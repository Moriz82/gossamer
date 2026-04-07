import { useState } from "react";
import { apiJson } from "../api";

export default function DataPanel() {
  const [zipPath, setZipPath] = useState("");
  const [replace, setReplace] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  async function exportBundle() {
    setMsg(null);
    try {
      const r = await apiJson<{ path?: string }>("/api/export/bundle", { method: "POST" });
      setMsg(`Export written: ${r.path}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  async function importBundle() {
    setMsg(null);
    try {
      const r = await apiJson<Record<string, unknown>>("/api/import/bundle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zip_path: zipPath, replace }),
      });
      setMsg(`Import ok: ${JSON.stringify(r)}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="panel-block">
      <div className="card">
        <h2>Export</h2>
        <p className="muted">Writes a zip under the server exports directory (see Settings for path).</p>
        <div className="form-actions">
          <button type="button" onClick={() => void exportBundle()}>
            Create bundle zip
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Import</h2>
        <p className="muted">
          Path must be readable by the API process. Replaces the live SQLite file when enabled.
        </p>
        <div className="form-grid">
          <label className="full">
            Zip path (server)
            <input value={zipPath} onChange={(e) => setZipPath(e.target.value)} placeholder="/path/to/bundle.zip" />
          </label>
          <label className="inline-check">
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
            Replace existing database file
          </label>
        </div>
        <div className="form-actions">
          <button type="button" onClick={() => void importBundle()} disabled={!zipPath}>
            Import bundle
          </button>
        </div>
      </div>

      {msg ? <pre className="panel-msg">{msg}</pre> : null}
    </div>
  );
}
