# ── TextStream Backend – Production Dockerfile ───────────────────
# Single stage: installs FFmpeg + Python deps, runs gunicorn with a
# single uvicorn worker (required for in-memory global state).

FROM python:3.11-slim

# Install FFmpeg for video decoding + audio extraction
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r textstream && useradd -r -g textstream -d /app -s /bin/false textstream

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code (less-frequently-changed dirs first for cache)
COPY video_processor/ video_processor/
COPY websocket_manager.py main.py ./

# Create uploads directory
RUN mkdir -p uploads && chown -R textstream:textstream /app

USER textstream

EXPOSE 8766

# Single worker is REQUIRED – the backend uses in-memory global state
# (active_decoder, current_video_meta, etc.) that would not be shared
# across multiple processes. Logs go to stdout for container platforms.
CMD exec gunicorn main:app \
    --worker-class uvicorn.workers.UvicornWorker \
    --workers 1 \
    --bind 0.0.0.0:${PORT:-8766} \
    --timeout 120 \
    --keep-alive 5 \
    --access-logfile - \
    --error-logfile - \
    --log-level info
