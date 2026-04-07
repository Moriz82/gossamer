from __future__ import annotations

from fastapi.testclient import TestClient


def test_change_runtime_credentials(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("GOSSAMER_DATABASE_PATH", str(tmp_path / "a.sqlite"))
    monkeypatch.setenv("GOSSAMER_UPLOADS_DIR", str(tmp_path / "u"))
    monkeypatch.setenv("GOSSAMER_EXPORTS_DIR", str(tmp_path / "e"))
    monkeypatch.setenv("GOSSAMER_AUTH_DISABLED", "false")
    monkeypatch.setenv("GOSSAMER_AUTH_USERNAME", "gossamer")
    monkeypatch.setenv("GOSSAMER_AUTH_PASSWORD", "gossamer")

    from gossamer.app import app

    with TestClient(app) as client:
        r = client.post(
            "/api/settings/auth",
            auth=("gossamer", "gossamer"),
            json={"current_password": "gossamer", "new_username": "admin", "new_password": "newsecret"},
        )
        assert r.status_code == 200
        h = client.get("/api/health", auth=("admin", "newsecret"))
        assert h.status_code == 200
