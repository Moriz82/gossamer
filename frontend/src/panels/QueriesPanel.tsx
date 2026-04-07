import { useEffect, useState } from "react";
import { apiJson } from "../api";

type Q = { name: string; description: string };

export default function QueriesPanel() {
  const [list, setList] = useState<Q[]>([]);
  const [active, setActive] = useState<string>("");
  const [rows, setRows] = useState<unknown>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    apiJson<Q[]>("/api/queries")
      .then((r) => {
        setList(r);
        if (r.length && !active) setActive(r[0].name);
      })
      .catch((e) => setMsg(e instanceof Error ? e.message : String(e)));
  }, []);

  async function run() {
    if (!active) return;
    setMsg(null);
    try {
      const r = await apiJson<unknown[]>(`/api/queries/${encodeURIComponent(active)}/run`, {
        method: "POST",
      });
      setRows(r);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      setRows(null);
    }
  }

  return (
    <div className="panel-block">
      <h2>Saved SQL queries</h2>
      <p className="muted">Registered in the backend query registry. Results are JSON rows.</p>
      <div className="query-row">
        <select value={active} onChange={(e) => setActive(e.target.value)}>
          {list.map((q) => (
            <option key={q.name} value={q.name}>
              {q.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void run()}>
          Run
        </button>
      </div>
      {list.find((q) => q.name === active)?.description ? (
        <p className="muted">{list.find((q) => q.name === active)?.description}</p>
      ) : null}
      {rows != null ? <pre className="panel-msg tall">{JSON.stringify(rows, null, 2)}</pre> : null}
      {msg ? <pre className="panel-msg">{msg}</pre> : null}
    </div>
  );
}
