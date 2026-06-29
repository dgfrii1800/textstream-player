"""TextStream Backend - FastAPI server for video-to-text streaming."""

import asyncio
import json
import logging
import os
import subprocess
import time
import uuid
from pathlib import Path
from typing import Optional

import aiofiles
from fastapi import FastAPI, File, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from video_processor import DeltaEncoder, FrameConverter, VideoDecoder
from video_processor.converter import ColorMode, RenderingMode
from websocket_manager import WebSocketManager

# ── Logging ──────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("textstream")

# ── App Setup ────────────────────────────────────────────────────────────
app = FastAPI(title="TextStream", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── State ────────────────────────────────────────────────────────────────
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

FFMPEG_PATH = os.environ.get("FFMPEG_PATH", "ffmpeg")

# Production static frontend — built by Dockerfile, served by FastAPI
STATIC_DIR = Path("static")
_HAS_STATIC = STATIC_DIR.is_dir() and (STATIC_DIR / "index.html").exists()

ws_manager = WebSocketManager()
active_decoder: Optional[VideoDecoder] = None
current_video_id: Optional[str] = None
current_video_meta: dict = {}
current_audio_path: Optional[Path] = None
current_has_audio: bool = False

streaming_task: Optional[asyncio.Task] = None
streaming_event = asyncio.Event()


# ── Helpers ──────────────────────────────────────────────────────────────
def get_video_path(video_id: str) -> Path:
    return UPLOAD_DIR / f"{video_id}.mp4"


def get_audio_path(video_id: str) -> Path:
    return UPLOAD_DIR / f"{video_id}.wav"


def extract_audio(video_path: Path, audio_path: Path) -> bool:
    """Extract audio track from video as WAV using FFmpeg."""
    ffmpeg = VideoDecoder.find_ffmpeg()
    cmd = [
        ffmpeg,
        "-i", str(video_path),
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "44100",
        "-ac", "2",
        "-y",
        str(audio_path),
    ]
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=120
        )
        if result.returncode == 0 and audio_path.exists() and audio_path.stat().st_size > 0:
            logger.info(f"Audio extracted: {audio_path}")
            return True
        else:
            logger.warning(f"No audio track found or extraction failed: {result.stderr[:200]}")
            audio_path.unlink(missing_ok=True)
            return False
    except Exception as e:
        logger.warning(f"Audio extraction error: {e}")
        audio_path.unlink(missing_ok=True)
        return False


# ── REST Endpoints ──────────────────────────────────────────────────────
@app.get("/api/health")
async def health():
    return {"status": "ok", "ffmpeg": FFMPEG_PATH}


@app.post("/api/upload")
async def upload_video(file: UploadFile = File(...)):
    """Upload a video file for processing."""
    global active_decoder, current_video_id, current_video_meta, current_audio_path, current_has_audio

    ext = Path(file.filename or "video.mp4").suffix.lower()
    if ext not in VideoDecoder.SUPPORTED_FORMATS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported format: {ext}. Supported: {', '.join(VideoDecoder.SUPPORTED_FORMATS)}",
        )

    video_id = str(uuid.uuid4())
    video_path = get_video_path(video_id)

    async with aiofiles.open(video_path, "wb") as f:
        content = await file.read()
        await f.write(content)

    try:
        decoder = VideoDecoder(str(video_path), ffmpeg_path=FFMPEG_PATH)
        metadata = decoder.read_metadata()

        if metadata["width"] == 0:
            raise HTTPException(status_code=400, detail="Could not read video metadata")

        active_decoder = decoder
        current_video_id = video_id
        current_video_meta = metadata

        # Extract audio in background
        audio_path = get_audio_path(video_id)

        async def extract_audio_async():
            global current_has_audio, current_audio_path
            loop = asyncio.get_event_loop()
            has_audio = await loop.run_in_executor(
                None, extract_audio, video_path, audio_path
            )
            current_has_audio = has_audio
            if has_audio:
                current_audio_path = audio_path
                logger.info(f"Audio ready for {video_id}")
            else:
                current_audio_path = None

        asyncio.create_task(extract_audio_async())

        logger.info(f"Video uploaded: {file.filename} ({metadata['width']}x{metadata['height']}, {metadata['fps']}fps)")

        return {
            "video_id": video_id,
            "metadata": {**metadata, "has_audio": True},  # optimistic – will be refined
            "message": "Video uploaded successfully",
        }
    except Exception as e:
        video_path.unlink(missing_ok=True)
        logger.error(f"Upload error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/audio/{video_id}")
async def get_audio(video_id: str):
    """Get extracted audio file for a video."""
    audio_path = get_audio_path(video_id)
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="No audio track found for this video")
    return FileResponse(
        str(audio_path),
        media_type="audio/wav",
        filename=f"{video_id}.wav",
    )


@app.get("/api/video/{video_id}")
async def get_video(video_id: str):
    """Get video metadata."""
    if video_id == current_video_id and current_video_meta:
        return {"video_id": video_id, "metadata": current_video_meta}

    video_path = get_video_path(video_id)
    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Video not found")

    try:
        decoder = VideoDecoder(str(video_path), ffmpeg_path=FFMPEG_PATH)
        metadata = decoder.read_metadata()
        return {"video_id": video_id, "metadata": metadata}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/metadata")
async def get_current_metadata():
    """Get metadata for the currently loaded video."""
    if not current_video_meta:
        raise HTTPException(status_code=404, detail="No video loaded")
    meta = dict(current_video_meta)
    meta["has_audio"] = current_has_audio
    return {"video_id": current_video_id, "metadata": meta}


@app.post("/api/play")
async def play():
    """Start playback."""
    if not active_decoder:
        raise HTTPException(status_code=404, detail="No video loaded")
    streaming_event.set()
    return {"status": "playing"}


@app.post("/api/pause")
async def pause():
    """Pause playback."""
    streaming_event.clear()
    return {"status": "paused"}


@app.post("/api/seek")
async def seek(frame: int = Query(0)):
    """Seek to a specific frame."""
    if not active_decoder:
        raise HTTPException(status_code=404, detail="No video loaded")
    for state in ws_manager.states.values():
        state.current_frame = max(0, frame)
    return {"status": "seeking", "frame": frame}


@app.post("/api/settings")
async def update_settings(settings: dict):
    """Update streaming settings."""
    for state in ws_manager.states.values():
        if "fps" in settings:
            state.target_fps = max(1, min(60, float(settings["fps"])))
        if "mode" in settings:
            state.requested_mode = settings["mode"]
        if "resolution" in settings:
            state.requested_resolution = max(40, min(400, int(settings["resolution"])))
        if "brightness" in settings:
            state.brightness = max(0.1, min(3.0, float(settings["brightness"])))
        if "contrast" in settings:
            state.contrast = max(0.1, min(3.0, float(settings["contrast"])))
        if "gamma" in settings:
            state.gamma = max(0.1, min(3.0, float(settings["gamma"])))
        if "density" in settings:
            state.density = max(0.1, min(2.0, float(settings["density"])))
    return {"status": "settings_updated", "settings": settings}


@app.get("/api/stats")
async def get_stats():
    """Get current streaming statistics."""
    return ws_manager.get_all_states()


# ── WebSocket Endpoint ──────────────────────────────────────────────────
@app.websocket("/ws/stream")
async def websocket_stream(websocket: WebSocket):
    """WebSocket endpoint for streaming text frames."""
    client_id = str(uuid.uuid4())
    await ws_manager.connect(client_id, websocket)

    message_task: Optional[asyncio.Task] = None

    try:
        # Send initial connection info
        await ws_manager.send_json(
            client_id,
            {
                "type": "connected",
                "client_id": client_id,
                "video_loaded": current_video_id is not None,
                "metadata": current_video_meta or {},
            },
        )

        # Handle incoming messages in a task
        message_task = asyncio.create_task(
            ws_manager.handle_messages(client_id, active_decoder)
        )

        state = ws_manager.states[client_id]

        # Start streaming loop for this client
        while True:
            if not state.is_playing or not active_decoder:
                await asyncio.sleep(0.1)
                continue

            # Stream frames
            frame_interval = 1.0 / max(1, state.target_fps)
            start_time = time.time()

            # Calculate target dimensions
            target_width = state.requested_resolution
            aspect = active_decoder.height / active_decoder.width if active_decoder.width else 1
            target_height = int(target_width * aspect * 0.5)

            # Build converter with current settings
            converter = FrameConverter(
                mode=RenderingMode(state.requested_mode),
                color_mode=ColorMode.FULL_RGB,
                brightness=state.brightness,
                contrast=state.contrast,
                gamma=state.gamma,
                density=state.density,
            )

            encoder = DeltaEncoder()

            frame_count = 0
            async_for_frame = active_decoder.extract_frames(
                target_width=target_width,
                target_height=target_height,
                target_fps=state.target_fps,
            )

            async for frame_array in async_for_frame:
                if not state.is_playing:
                    break

                convert_start = time.time()
                cells = converter.convert_frame(frame_array)
                convert_time = time.time() - convert_start

                encode_start = time.time()
                encoded = encoder.encode(cells, force_keyframe=(frame_count == 0))
                encode_time = time.time() - encode_start

                frame_count += 1
                now = time.time()
                elapsed = now - start_time

                # Attach grid info
                encoded["grid_width"] = target_width
                encoded["grid_height"] = len(cells) // max(1, target_width)

                frame_stats = {
                    "frame_time_ms": round(elapsed * 1000 / max(1, frame_count), 1),
                    "convert_time_ms": round(convert_time * 1000, 1),
                    "encode_time_ms": round(encode_time * 1000, 1),
                    "cells_count": len(cells),
                    "changed_count": len(encoded["cells"]),
                    "compression_ratio": encoder.get_compression_ratio(),
                    "frame_rate": round(frame_count / max(0.001, elapsed), 1),
                }

                encoded["stats"] = frame_stats
                encoded["type"] = "frame"

                await ws_manager.send_json(client_id, encoded)

                # Maintain target FPS
                target_time = frame_count * frame_interval
                sleep_time = target_time - (time.time() - start_time)
                if sleep_time > 0:
                    await asyncio.sleep(sleep_time)

    except WebSocketDisconnect:
        logger.info(f"Client {client_id} disconnected")
    except Exception as e:
        logger.error(f"WebSocket error for {client_id}: {e}")
    finally:
        if message_task:
            message_task.cancel()
        ws_manager.disconnect(client_id)


# ── SPA static file serving (registered AFTER API routes so they take priority) ──
if _HAS_STATIC:
    logger.info(f"Serving frontend static files from {STATIC_DIR}")
    app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        """SPA fallback — serve files directly or index.html for client-side routing."""
        if full_path.startswith("api/") or full_path.startswith("ws/"):
            raise HTTPException(status_code=404)
        # Prevent path traversal
        file_path = (STATIC_DIR / full_path).resolve()
        if not str(file_path).startswith(str(STATIC_DIR.resolve())):
            raise HTTPException(status_code=404)
        # Serve static files (favicon, logo, manifest, etc.) directly
        if file_path.is_file():
            return FileResponse(str(file_path))
        # SPA fallback — let React Router handle the route
        index = STATIC_DIR / "index.html"
        if index.exists():
            return HTMLResponse(index.read_bytes(), media_type="text/html")
        raise HTTPException(status_code=404)


# ── Startup ──────────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    logger.info("TextStream backend starting up")
    try:
        VideoDecoder.find_ffmpeg()
        logger.info("FFmpeg found")
    except FileNotFoundError as e:
        logger.warning(f"FFmpeg not found: {e}")


# ── Entrypoint ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    # Railway injects $PORT; fall back to 8766 for local dev
    port = int(os.environ.get("PORT", os.environ.get("TEXTSTREAM_PORT", "8766")))
    reload_flag = os.environ.get("RAILWAY") is None  # no reload in prod
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=reload_flag)
