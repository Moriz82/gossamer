import { useEffect, useState } from "react";
import { apiJson } from "../api";

export default function RegistryPanel() {
  const [data, setData] = useState<unknown>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiJson("/api/graph-type-registry")
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  if (err) return <pre className="panel-msg">{err}</pre>;
  return (
    <div className="panel-block">
      <h2>Graph type registry</h2>
      <p className="muted">Node and edge kinds, colors, and labels from backend plugins.</p>
      <pre className="tall-pre">{data ? JSON.stringify(data, null, 2) : "…"}</pre>
    </div>
  );
}
