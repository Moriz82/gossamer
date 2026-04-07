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
      <div className="login-web-bg" />
      <div className="login-card">
        <div className="login-brand">
          <svg viewBox="0 0 32 32" width="40" height="40" className="login-logo">
            <g stroke="currentColor" strokeWidth="0.6" opacity="0.6">
              <line x1="16" y1="16" x2="16" y2="1"/>
              <line x1="16" y1="16" x2="29" y2="5"/>
              <line x1="16" y1="16" x2="31" y2="16"/>
              <line x1="16" y1="16" x2="29" y2="27"/>
              <line x1="16" y1="16" x2="16" y2="31"/>
              <line x1="16" y1="16" x2="3" y2="27"/>
              <line x1="16" y1="16" x2="1" y2="16"/>
              <line x1="16" y1="16" x2="3" y2="5"/>
            </g>
            <g fill="none" stroke="currentColor" strokeWidth="0.4" opacity="0.35">
              <circle cx="16" cy="16" r="5"/>
              <circle cx="16" cy="16" r="10"/>
              <circle cx="16" cy="16" r="14"/>
            </g>
            <circle cx="16" cy="16" r="2" fill="currentColor" opacity="0.8"/>
          </svg>
          <h1>Gossamer</h1>
        </div>
        <form onSubmit={onSubmit} autoComplete="off">
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
          {error && <div className="login-error" role="alert">{error}</div>}
          <button type="submit" className="primary login-submit" disabled={busy}>
            {busy ? <span className="loading-silk">Connecting...</span> : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
