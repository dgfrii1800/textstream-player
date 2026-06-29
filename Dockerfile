# ── TextStream – Unified Production Dockerfile ───────────────────
# Builds frontend + backend into a single container.
# FastAPI serves the SPA static files alongside its API.
# One push to GitHub → Railway auto-deploys.

# ── Stage 1: Build Frontend ──────────────────────────────────────
FROM oven/bun:1 AS frontend

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY vite.config.ts ./
COPY index.html ./
COPY vly-toolbar-readonly.tsx ./
COPY public/ public/
COPY src/ src/
RUN bun run build

# ── Stage 2: Backend Runtime ─────────────────────────────────────
FROM python:3.11-slim

# Install FFmpeg + cleanup
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r textstream && useradd -r -g textstream -d /app -s /bin/false textstream

WORKDIR /app

# Install Python dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend application code
COPY backend/video_processor/ video_processor/
COPY backend/websocket_manager.py .
COPY backend/main.py .

# Copy built frontend from Stage 1
COPY --from=frontend /app/dist /app/static

# Create uploads directory
RUN mkdir -p uploads && chown -R textstream:textstream /app

USER textstream

EXPOSE 8766

# Start FastAPI — serves both API + SPA static files
CMD exec gunicorn main:app \
    --worker-class uvicorn.workers.UvicornWorker \
    --workers 1 \
    --preload \
    --bind 0.0.0.0:${PORT:-8766} \
    --timeout 120 \
    --keep-alive 5 \
    --access-logfile - \
    --error-logfile - \
    --log-level info
