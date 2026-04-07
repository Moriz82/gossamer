import { useEffect, useState } from "react";
import { apiJson } from "../api";

type TypeEntry = { kind: string; color: string; label: string };

type RegistryData = {
  nodes: Record<string, TypeEntry>;
  edges: Record<string, TypeEntry>;
};

function isRegistryData(d: unknown): d is RegistryData {
  if (!d || typeof d !== "object") return false;
  const obj = d as Record<string, unknown>;
  return (
    typeof obj.nodes === "object" &&
    obj.nodes !== null &&
    typeof obj.edges === "object" &&
    obj.edges !== null
  );
}

function TypeTable({ entries }: { entries: TypeEntry[] }) {
  return (
    <div className="settings-table-wrap">
      <table className="settings-table">
        <thead>
          <tr>
            <th>Kind</th>
            <th>Color</th>
            <th>Label</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.kind}>
              <td>
                <code>{e.kind}</code>
              </td>
              <td>
                <span
                  className="color-swatch"
                  style={{ backgroundColor: e.color }}
                />{" "}
                {e.color}
              </td>
              <td>{e.label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function RegistryPanel() {
  const [data, setData] = useState<unknown>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiJson("/api/graph-type-registry")
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  if (err) return <pre className="panel-msg">{err}</pre>;

  if (!data) {
    return (
      <div className="panel-block">
        <h2>Graph type registry</h2>
        <p className="muted">Loading...</p>
      </div>
    );
  }

  if (!isRegistryData(data)) {
    return (
      <div className="panel-block">
        <h2>Graph type registry</h2>
        <p className="muted">Node and edge kinds, colors, and labels from backend plugins.</p>
        <pre className="tall-pre">{JSON.stringify(data, null, 2)}</pre>
      </div>
    );
  }

  const nodeEntries = Object.values(data.nodes);
  const edgeEntries = Object.values(data.edges);

  return (
    <div className="panel-block">
      <div className="card">
        <h2>Node types</h2>
        <p className="muted">Registered node kinds with their display colors and labels.</p>
        <TypeTable entries={nodeEntries} />
      </div>

      <div className="card">
        <h2>Edge types</h2>
        <p className="muted">Registered edge kinds with their display colors and labels.</p>
        <TypeTable entries={edgeEntries} />
      </div>
    </div>
  );
}
