# AUREX API / worker image (FastAPI + Celery share one image; the command selects the role).
# Build:  docker build -t aurex-api ./backend
FROM python:3.13-slim AS build

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

COPY --from=ghcr.io/astral-sh/uv:0.11.24 /uv /usr/local/bin/uv

WORKDIR /app
# Dependencies first (cached layer), exactly as pinned in uv.lock, without dev tools.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY alembic.ini ./
COPY migrations ./migrations
COPY app ./app


FROM python:3.13-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH" \
    AUREX_STORAGE_DIR=/data/storage

RUN groupadd --system --gid 10001 aurex \
    && useradd --system --uid 10001 --gid aurex --home-dir /app --shell /usr/sbin/nologin aurex \
    && mkdir -p /data/storage \
    && chown -R aurex:aurex /data

WORKDIR /app
COPY --from=build --chown=aurex:aurex /app /app

USER aurex
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=4)"]

# --proxy-headers lets uvicorn report the scheme set by the edge proxy; client IPs for rate limiting are
# resolved by the application from X-Forwarded-For using AUREX_TRUSTED_PROXY_HOPS.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2", "--proxy-headers", "--forwarded-allow-ips", "*"]
