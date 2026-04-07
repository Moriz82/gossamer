import { FormEvent, useState } from "react";
import { apiFetch, clearAuth, setAuth } from "./api";

type Props = {
  onAuthed: () => void;
};

export default function LoginGate({ onAuthed }: Props) {
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function trySession() {
    try {
      const r = await apiFetch("/api/health");
      if (r.ok) {
        onAuthed();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    clearAuth();
    setAuth(user, password);
    trySession()
      .then((ok) => {
        if (!ok) {
          setError("Invalid credentials or API unreachable. Is the backend running on port 8000?");
        }
      })
      .finally(() => setBusy(false));
  }

  return (
    <div className="login-overlay">
      <form className="login-card" onSubmit={onSubmit} autoComplete="off">
        <h1>Gossamer</h1>
        <p className="muted">
          Sign in with the HTTP Basic credentials configured for the API. Bootstrap defaults are documented only
          in <code>README.md</code> (not pre-filled here).
        </p>
        <label>
          Username
          <input
            name="username"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </label>
        {error ? <p className="login-error" role="alert">{error}</p> : null}
        <button type="submit" disabled={busy}>
          {busy ? "Checking…" : "Continue"}
        </button>
      </form>
    </div>
  );
}
