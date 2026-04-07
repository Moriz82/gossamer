from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi.testclient import TestClient


def test_settings_get_and_patch(isolated_client: "TestClient") -> None:
    r = isolated_client.get("/api/settings")
    assert r.status_code == 200
    data = r.json()
    assert "effective" in data
    assert "runtime" in data
    assert "env_paths" in data
    assert "env" in data
    assert "auth" in data
    assert data["env_paths"]["database_path"].endswith("graph.sqlite")

    r2 = isolated_client.patch(
        "/api/settings",
        json={"pipeline": {"crawl_max_depth": 4}, "ui": {"graph_layout": "grid"}},
    )
    assert r2.status_code == 200
    body = r2.json()
    assert body["effective"]["crawl_max_depth"] == 4
    assert body["runtime"]["ui"]["graph_layout"] == "grid"


def test_settings_patch_preserves_unset_pipeline_fields(isolated_client: "TestClient") -> None:
    isolated_client.patch(
        "/api/settings",
        json={"pipeline": {"crawl_user_agent": "TestAgent/1.0"}},
    )
    r = isolated_client.get("/api/settings")
    eff = r.json()["effective"]
    assert eff["crawl_user_agent"] == "TestAgent/1.0"
