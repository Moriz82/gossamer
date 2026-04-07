import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiJson } from "../api";

type FindingRow = {
  id: string;
  kind: string;
  key: string;
  properties: Record<string, unknown>;
};

type FindingsResponse = { findings: FindingRow[]; count: number };

type SignalRow = Record<string, unknown>;

function severityClass(sev: string): string {
  const s = sev.toLowerCase();
  if (s === "critical" || s === "high") return "sev sev-high";
  if (s === "medium") return "sev sev-medium";
  if (s === "low" || s === "info") return "sev sev-low";
  return "sev sev-unknown";
}

export default function VulnsPanel() {
  const [findings, setFindings] = useState<FindingRow[] | null>(null);
  const [signals, setSignals] = useState<SignalRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sigErr, setSigErr] = useState<string | null>(null);

  const loadFindings = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await apiJson<FindingsResponse>("/api/findings?limit=5000");
      setFindings(data.findings);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setFindings([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFindings();
  }, [loadFindings]);

  const loadSurfaceSignals = async () => {
    setSignalsLoading(true);
    setSigErr(null);
    try {
      const r = await apiFetch("/api/queries/interesting_status_codes/run", { method: "POST" });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(t || r.statusText);
      }
      const rows = (await r.json()) as SignalRow[];
      setSignals(rows);
    } catch (e) {
      setSigErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSignalsLoading(false);
    }
  };

  if (err) {
    return <pre className="panel-msg">{err}</pre>;
  }

  return (
    <div className="panel-block vulns-panel">
      <div className="card">
        <div className="card-head">
          <h2>Scanner findings</h2>
          <button type="button" className="btn-secondary" onClick={() => void loadFindings()} disabled={loading}>
            Refresh
          </button>
        </div>
        <p className="muted">
          Rows come from <code>Finding</code> nodes (for example Nuclei JSON/JSONL via the{" "}
          <code>nuclei_json</code> ingestor). Ingest a Nuclei export, then refresh.
        </p>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : !findings?.length ? (
          <p className="empty-hint">No findings in the graph yet.</p>
        ) : (
          <div className="settings-table-wrap">
            <table className="settings-table findings-table">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Name</th>
                  <th>Scanner</th>
                  <th>Template</th>
                  <th>Target</th>
                </tr>
              </thead>
              <tbody>
                {findings.map((f) => {
                  const p = f.properties;
                  const sev = String(p.severity ?? "—");
                  const name = String(p.name ?? p.template_id ?? "—");
                  const scanner = String(p.scanner ?? "—");
                  const tid = String(p.template_id ?? "—");
                  const target = String(p.matched_at ?? p.host ?? "").slice(0, 120);
                  return (
                    <tr key={f.id}>
                      <td>
                        <span className={severityClass(sev)}>{sev}</span>
                      </td>
                      <td>{name}</td>
                      <td>
                        <code>{scanner}</code>
                      </td>
                      <td className="muted truncate-cell" title={tid}>
                        {tid}
                      </td>
                      <td className="muted truncate-cell" title={target}>
                        {target || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Surface signals</h2>
        <p className="muted">
          Endpoints returning HTTP 401, 403, or 500 from passive or crawl data — useful context alongside
          scanner hits.
        </p>
        <div className="toolbar-row">
          <button type="button" className="primary" onClick={() => void loadSurfaceSignals()} disabled={signalsLoading}>
            {signalsLoading ? "Loading…" : "Load interesting status codes"}
          </button>
        </div>
        {sigErr ? <p className="login-error">{sigErr}</p> : null}
        {signals && signals.length === 0 ? (
          <p className="empty-hint">No matching endpoints.</p>
        ) : null}
        {signals && signals.length > 0 ? (
          <div className="settings-table-wrap">
            <table className="settings-table">
              <thead>
                <tr>
                  <th>URL / key</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {signals.map((row, i) => {
                  const props = (row.properties as Record<string, unknown> | undefined) ?? {};
                  const url = String(props.url ?? row.key ?? "");
                  const code = props.status_code;
                  return (
                    <tr key={String(row.id ?? i)}>
                      <td className="truncate-cell" title={url}>
                        {url}
                      </td>
                      <td>{code != null ? String(code) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
