"""Application settings.

All configuration comes from environment variables (prefix ``AUREX_``) or a ``.env`` file.
Secrets are typed as ``SecretStr`` so they never appear in ``repr`` output or logs.
Production startup refuses to run with development defaults (see ``validate_for_production``).
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_DIR = BACKEND_DIR.parent

# Development-only defaults. ``validate_for_production`` rejects these values.
_DEV_JWT_SECRET = "dev-only-insecure-jwt-secret-change-me-0123456789abcdef"  # noqa: S105 - rejected in production
_DEV_FERNET_KEY = "ZGV2LW9ubHktaW5zZWN1cmUta2V5LWNoYW5nZS1tZSE="  # base64 of 32 bytes, dev only


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="AUREX_",
        env_file=(str(REPO_DIR / ".env"), str(BACKEND_DIR / ".env")),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    env: Literal["development", "test", "production"] = "development"
    app_name: str = "AUREX"
    api_prefix: str = "/api/v1"
    log_level: str = "INFO"
    log_json: bool = False

    database_url: str = "postgresql+psycopg://aurex:aurex@127.0.0.1:5433/aurex"
    database_pool_size: int = 10
    database_echo: bool = False

    # Authentication
    jwt_secret: SecretStr = SecretStr(_DEV_JWT_SECRET)
    jwt_issuer: str = "aurex"
    jwt_audience: str = "aurex-api"
    access_token_ttl_minutes: int = 15
    refresh_token_ttl_days: int = 14
    cookie_secure: bool = False
    cookie_domain: str | None = None
    password_min_length: int = 10
    max_failed_logins: int = 5
    lockout_minutes: int = 15
    argon2_time_cost: int = 3
    argon2_memory_cost_kib: int = 65536
    invitation_ttl_days: int = 7

    # Encryption of integration secrets at rest (Fernet key, urlsafe base64 of 32 bytes)
    secret_encryption_key: SecretStr = SecretStr(_DEV_FERNET_KEY)

    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000", "http://127.0.0.1:3000"])
    # Number of trusted reverse proxies in front of the API that set/append X-Forwarded-For (e.g. 1 for the
    # Caddy edge in docker-compose). 0 = ignore X-Forwarded-For and use the socket peer address, so clients
    # cannot spoof their IP to evade rate limits.
    trusted_proxy_hops: int = Field(default=0, ge=0, le=5)

    # Infrastructure
    redis_url: str | None = None
    task_backend: Literal["inline", "celery"] = "inline"
    storage_dir: Path = REPO_DIR / ".data" / "storage"
    max_upload_mb: int = 25

    # Rate limiting (requests per window)
    rate_limit_enabled: bool = True
    rate_limit_auth_per_minute: int = 10
    rate_limit_api_per_minute: int = 600
    rate_limit_advisor_per_minute: int = 20

    # AI advisor (optional). Without a key the advisor runs in deterministic tool-routing mode.
    anthropic_api_key: SecretStr | None = None
    advisor_model: str = "claude-opus-5-5"
    advisor_max_tool_rounds: int = 6

    # Market data (optional). Without a provider only stored, sourced snapshots are shown.
    market_data_provider: Literal["none", "alphavantage", "twelvedata"] = "none"
    market_data_api_key: SecretStr | None = None

    # News ingestion
    news_fetch_enabled: bool = False
    news_http_timeout_seconds: float = 10.0

    # Connectors may reach private networks only when the operator allows it (on-premise installs)
    allow_private_network_connectors: bool = False

    # Demo mode: seeds NovaMart (synthetic) and enables demo sign-in shortcuts
    demo_mode: bool = True
    # Allow demo mode with AUREX_ENV=production, for a public showcase that holds ONLY synthetic data.
    allow_demo_in_production: bool = False
    demo_end_date: str = "2026-10-17"  # last day of the synthetic NovaMart history (reproducible)
    demo_seed: int = 20231001
    # Run inline background jobs synchronously (tests) instead of on a thread pool
    inline_jobs_synchronous: bool = False

    # Data retention (days). 0 disables purging for that class.
    retention_audit_days: int = 730
    retention_sync_error_days: int = 180
    retention_notification_days: int = 180
    retention_report_days: int = 365

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            stripped = value.strip()
            if stripped.startswith("["):
                return value
            return [item.strip() for item in stripped.split(",") if item.strip()]
        return value

    @property
    def is_production(self) -> bool:
        return self.env == "production"

    @property
    def is_test(self) -> bool:
        return self.env == "test"

    def validate_for_production(self) -> list[str]:
        """Return a list of configuration problems that make the settings unsafe for production."""
        problems: list[str] = []
        if not self.is_production:
            return problems
        if self.jwt_secret.get_secret_value() == _DEV_JWT_SECRET or len(self.jwt_secret.get_secret_value()) < 32:
            problems.append("AUREX_JWT_SECRET must be set to a random value of at least 32 characters")
        if self.secret_encryption_key.get_secret_value() == _DEV_FERNET_KEY:
            problems.append("AUREX_SECRET_ENCRYPTION_KEY must be set to a freshly generated Fernet key")
        if not self.cookie_secure:
            problems.append("AUREX_COOKIE_SECURE must be true in production (HTTPS only cookies)")
        if "aurex:aurex@" in self.database_url:
            problems.append("AUREX_DATABASE_URL uses the development password")
        if self.demo_mode and not self.allow_demo_in_production:
            problems.append("AUREX_DEMO_MODE must be false in production (demo sign-in shortcuts); set "
                            "AUREX_ALLOW_DEMO_IN_PRODUCTION=true only for a showcase holding synthetic data alone")
        return problems


@lru_cache
def get_settings() -> Settings:
    return Settings()
