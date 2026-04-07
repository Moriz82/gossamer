const AUTH_KEY = "gossamer_basic";

export function getAuthHeader(): string | null {
  return sessionStorage.getItem(AUTH_KEY);
}

export function setAuth(user: string, password: string): void {
  const token = btoa(`${user}:${password}`);
  sessionStorage.setItem(AUTH_KEY, `Basic ${token}`);
}

export function clearAuth(): void {
  sessionStorage.removeItem(AUTH_KEY);
}

export function isAuthStored(): boolean {
  return Boolean(getAuthHeader());
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const auth = getAuthHeader();
  if (auth) {
    headers.set("Authorization", auth);
  }
  const r = await fetch(path, { ...init, headers });
  if (r.status === 401) {
    clearAuth();
  }
  return r;
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await apiFetch(path, init);
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || r.statusText);
  }
  return r.json() as Promise<T>;
}
