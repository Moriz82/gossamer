from __future__ import annotations

import os

# Default for most tests; API tests override via isolated_client fixture.
os.environ.setdefault("GOSSAMER_AUTH_DISABLED", "true")

import pytest
from pathlib import Path


@pytest.fixture
def isolated_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Fresh SQLite + uploads/exports dirs and TestClient with lifespan per test."""
    monkeypatch.setenv("GOSSAMER_DATABASE_PATH", str(tmp_path / "graph.sqlite"))
    monkeypatch.setenv("GOSSAMER_UPLOADS_DIR", str(tmp_path / "uploads"))
    monkeypatch.setenv("GOSSAMER_EXPORTS_DIR", str(tmp_path / "exports"))
    monkeypatch.setenv("GOSSAMER_AUTH_DISABLED", "true")

    # Import after env is set so module-level CORS settings match this test layout.
    from fastapi.testclient import TestClient

    from gossamer.app import app

    with TestClient(app) as client:
        yield client
