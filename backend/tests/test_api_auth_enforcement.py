from __future__ import annotations

from fastapi.testclient import TestClient


def test_health_401_without_credentials_when_auth_enabled(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("GOSSAMER_DATABASE_PATH", str(tmp_path / "auth.sqlite"))
    monkeypatch.setenv("GOSSAMER_UPLOADS_DIR", str(tmp_path / "u"))
    monkeypatch.setenv("GOSSAMER_EXPORTS_DIR", str(tmp_path / "x"))
    monkeypatch.setenv("GOSSAMER_AUTH_DISABLED", "false")
    monkeypatch.setenv("GOSSAMER_AUTH_USERNAME", "gossamer")
    monkeypatch.setenv("GOSSAMER_AUTH_PASSWORD", "gossamer")

    from gossamer.app import app

    with TestClient(app) as client:
        r = client.get("/api/health")
        assert r.status_code == 401
        ok = client.get("/api/health", auth=("gossamer", "gossamer"))
        assert ok.status_code == 200
