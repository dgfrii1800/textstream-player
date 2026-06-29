"""TextStream Backend - FastAPI server for video-to-text streaming."""

import asyncio
import json
import logging
import os
import time
import uuid
from pathlib import Path
from typing import Optional

import aiofiles
from fastapi import FastAPI, File, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

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

FFMPEG_PATH = os.environ.get("FFMPEG_PATH", "/tmp/ffmpeg")

ws_manager = WebSocketManager()
active_decoder: Optional[VideoDecoder] = None
current_video_id: Optional[str] = None
current_video_meta: dict = {}

streaming_task: Optional[asyncio.Task] = None
streaming_event = asyncio.Event()


# ── Helpers ──────────────────────────────────────────────────────────────
def get_video_path(video_id: str) -> Path:
    return UPLOAD_DIR / f"{video_id}.mp4"


# ── REST Endpoints ──────────────────────────────────────────────────────
@app.get("/api/health")
async def health():
    return {"status": "ok", "ffmpeg": FFMPEG_PATH}


@app.post("/api/upload")
async def upload_video(file: UploadFile = File(...)):
    """Upload a video file for processing."""
    global active_decoder, current_video_id, current_video_meta

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

        logger.info(f"Video uploaded: {file.filename} ({metadata['width']}x{metadata['height']}, {metadata['fps']}fps)")

        return {
            "video_id": video_id,
            "metadata": metadata,
            "message": "Video uploaded successfully",
        }
    except Exception as e:
        video_path.unlink(missing_ok=True)
        logger.error(f"Upload error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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
    return {"video_id": current_video_id, "metadata": current_video_meta}


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
    # Reset delta encoder on seek
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
                target_height = int(target_width * aspect * 0.5)  # Account for character aspect ratio

                # Build converter with current settings
                converter = FrameConverter(
                    mode=RenderingMode(state.requested_mode),
                    color_mode=ColorMode.FULL_RGB,
                    brightness=state.brightness,
                    contrast=state.contrast,
                    gamma=state.gamma,
                    density=state.density,
                )

                # Encode with delta compression
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

                    # Add performance stats
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
        message_task.cancel()
        ws_manager.disconnect(client_id)


# ── Startup ──────────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    logger.info("TextStream backend starting up")
    # Verify FFmpeg
    try:
        VideoDecoder.find_ffmpeg()
        logger.info("FFmpeg found")
    except FileNotFoundError as e:
        logger.warning(f"FFmpeg not found: {e}")


# ── Entrypoint ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8765, reload=True)
