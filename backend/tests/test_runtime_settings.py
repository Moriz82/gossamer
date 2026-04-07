from __future__ import annotations

from gossamer.config import Settings
from gossamer.runtime_settings import get_effective_settings, load_runtime_payload, patch_runtime


def test_patch_and_effective_roundtrip(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("GOSSAMER_DATABASE_PATH", str(tmp_path / "db.sqlite"))
    base = Settings()
    payload = patch_runtime(
        base,
        {"pipeline": {"crawl_max_pages": 42, "crawl_user_agent": "UA-Test"}, "ui": {"node_size": 22}},
    )
    assert payload.pipeline.crawl_max_pages == 42
    assert payload.ui.node_size == 22

    eff = get_effective_settings()
    assert eff.crawl_max_pages == 42
    assert eff.crawl_user_agent == "UA-Test"

    again = load_runtime_payload(Settings())
    assert again.ui.node_size == 22


def test_effective_without_runtime_file_matches_env_defaults(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("GOSSAMER_DATABASE_PATH", str(tmp_path / "solo.sqlite"))
    eff = get_effective_settings()
    assert isinstance(eff.crawl_max_depth, int)
