from __future__ import annotations

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="GOSSAMER_", extra="ignore")

    database_path: Path = Field(default=Path("./data/graph.sqlite"))
    uploads_dir: Path = Field(default=Path("./uploads"))
    exports_dir: Path = Field(default=Path("./exports"))
    cors_origins: list[str] = Field(default_factory=lambda: ["http://127.0.0.1:5173", "http://localhost:5173"])
    # Empty list = no restriction (see pipeline/crawl); set hosts for scope-limited crawl
    scope_hosts: list[str] = Field(default_factory=list)
    normalizer_order: list[str] = Field(
        default_factory=lambda: [
            "lowercase_host",
            "collapse_trailing_slash",
            "strip_utm",
        ]
    )
    crawl_max_retries: int = Field(default=2, ge=0, le=5)
    crawl_max_depth: int = Field(default=3, ge=1, le=20)
    crawl_max_pages: int = Field(default=100, ge=1, le=10000)
    crawl_timeout_seconds: float = Field(default=15.0)
    crawl_user_agent: str = Field(
        default="GossamerCrawler/0.1 (+authorized testing only)"
    )
    crawl_respect_robots: bool = Field(default=True)
    crawl_parse_sitemaps: bool = Field(default=True)
    auth_username: str = Field(default="gossamer")
    auth_password: str = Field(default="gossamer")
    auth_disabled: bool = Field(default=False)
    crawl_persist_cookies: bool = Field(default=True)
    # Neo4j graph backend (when neo4j_uri is non-empty, app uses Neo4j instead of SQLite for the graph)
    neo4j_uri: str = Field(default="")
    neo4j_user: str = Field(default="neo4j")
    neo4j_password: str = Field(default="neo4j")
    neo4j_database: str = Field(default="neo4j")
    graph_snapshot_max_nodes: int = Field(default=8000, ge=100, le=500_000)
    graph_snapshot_max_edges: int = Field(default=16_000, ge=100, le=1_000_000)
    graph_path_max_hops: int = Field(default=25, ge=1, le=50)
    plugin_dir: Path = Field(default=Path.home() / ".gossamer" / "plugins")


def get_settings() -> Settings:
    return Settings()
