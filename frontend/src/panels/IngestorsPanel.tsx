import { useEffect, useState } from "react";
import { apiJson } from "../api";

type IngestorRow = { name: string; summary: string; hints: string; role: string };
type NormRow = { name: string; description: string };

export default function IngestorsPanel() {
  const [ingestors, setIngestors] = useState<IngestorRow[] | null>(null);
  const [normalizers, setNormalizers] = useState<NormRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let ok = true;
    Promise.all([
      apiJson<IngestorRow[]>("/api/ingestors"),
      apiJson<NormRow[]>("/api/normalizers"),
    ])
      .then(([i, n]) => {
        if (ok) {
          setIngestors(i);
          setNormalizers(n);
        }
      })
      .catch((e) => {
        if (ok) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      ok = false;
    };
  }, []);

  if (err) {
    return <pre className="panel-msg">{err}</pre>;
  }

  return (
    <div className="panel-block">
      <div className="card">
        <h2>Registered ingestors</h2>
        <p className="muted">
          Use the ingestor <strong>name</strong> as <code>ingestor_hint</code> on upload or path ingest when
          auto-detection is wrong. Order in the backend plugin list matters for ambiguous files.
        </p>
        <div className="settings-table-wrap">
          <table className="settings-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Summary</th>
                <th>Detection / hints</th>
              </tr>
            </thead>
            <tbody>
              {(ingestors ?? []).map((r) => (
                <tr key={r.name}>
                  <td>
                    <code>{r.name}</code>
                  </td>
                  <td>
                    <span className="role-pill">{r.role || "import"}</span>
                  </td>
                  <td>{r.summary}</td>
                  <td className="muted">{r.hints}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>URL normalizers</h2>
        <p className="muted">
          Configure pipeline order under <strong>Settings</strong>. Names must match these registry entries.
        </p>
        <div className="settings-table-wrap">
          <table className="settings-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {(normalizers ?? []).map((r) => (
                <tr key={r.name}>
                  <td>
                    <code>{r.name}</code>
                  </td>
                  <td>{r.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
