"""WebSocket connection manager for streaming text frames."""

import asyncio
import json
import logging
import time
from typing import Any, Dict, Optional, Set

from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger("textstream.websocket")


class ConnectionState:
    """Represents the state of a single WebSocket connection."""

    def __init__(self):
        self.is_playing: bool = False
        self.current_frame: int = 0
        self.target_fps: float = 24.0
        self.frame_ack: int = 0
        self.last_ping: float = time.time()
        self.requested_mode: str = "unicode"
        self.requested_resolution: int = 100  # target width
        self.brightness: float = 1.0
        self.contrast: float = 1.0
        self.gamma: float = 1.0
        self.density: float = 1.0
        self.paused: bool = False


class WebSocketManager:
    """Manages multiple WebSocket connections for streaming."""

    def __init__(self):
        self.connections: Dict[str, WebSocket] = {}
        self.states: Dict[str, ConnectionState] = {}
        self.video_task: Optional[asyncio.Task] = None
        self.video_id: Optional[str] = None

    async def connect(self, client_id: str, websocket: WebSocket):
        """Accept a new WebSocket connection."""
        await websocket.accept()
        self.connections[client_id] = websocket
        self.states[client_id] = ConnectionState()
        logger.info(f"Client {client_id} connected")

    def disconnect(self, client_id: str):
        """Remove a disconnected client."""
        self.connections.pop(client_id, None)
        self.states.pop(client_id, None)
        logger.info(f"Client {client_id} disconnected")

    async def send_json(self, client_id: str, data: dict):
        """Send JSON data to a specific client."""
        websocket = self.connections.get(client_id)
        if websocket:
            try:
                await websocket.send_json(data)
            except Exception as e:
                logger.error(f"Failed to send to {client_id}: {e}")
                self.disconnect(client_id)

    async def broadcast(self, data: dict, exclude: Optional[Set[str]] = None):
        """Broadcast JSON data to all connected clients."""
        exclude = exclude or set()
        disconnected = []
        for client_id, websocket in self.connections.items():
            if client_id not in exclude:
                try:
                    await websocket.send_json(data)
                except Exception:
                    disconnected.append(client_id)
        for cid in disconnected:
            self.disconnect(cid)

    async def handle_messages(self, client_id: str, video_processor=None):
        """Handle incoming messages from a WebSocket client."""
        websocket = self.connections.get(client_id)
        if not websocket:
            return

        state = self.states[client_id]

        try:
            while True:
                data = await websocket.receive_text()
                try:
                    message = json.loads(data)
                except json.JSONDecodeError:
                    continue

                await self._process_message(client_id, message, state, video_processor)

        except WebSocketDisconnect:
            self.disconnect(client_id)
        except Exception as e:
            logger.error(f"Error handling messages for {client_id}: {e}")
            self.disconnect(client_id)

    async def _process_message(
        self,
        client_id: str,
        message: dict,
        state: ConnectionState,
        video_processor=None,
    ):
        """Process a single message from a client."""
        msg_type = message.get("type", "")

        if msg_type == "play":
            state.is_playing = True
            state.paused = False
            await self.send_json(client_id, {"type": "status", "status": "playing"})

        elif msg_type == "pause":
            state.is_playing = False
            state.paused = True
            await self.send_json(client_id, {"type": "status", "status": "paused"})

        elif msg_type == "seek":
            frame = message.get("frame", 0)
            state.current_frame = max(0, frame)
            await self.send_json(
                client_id,
                {
                    "type": "status",
                    "status": "seeking",
                    "frame": state.current_frame,
                },
            )

        elif msg_type == "settings":
            if "fps" in message:
                state.target_fps = max(1, min(60, float(message["fps"])))
            if "mode" in message:
                state.requested_mode = message["mode"]
            if "resolution" in message:
                state.requested_resolution = max(40, min(400, int(message["resolution"])))
            if "brightness" in message:
                state.brightness = max(0.1, min(3.0, float(message["brightness"])))
            if "contrast" in message:
                state.contrast = max(0.1, min(3.0, float(message["contrast"])))
            if "gamma" in message:
                state.gamma = max(0.1, min(3.0, float(message["gamma"])))
            if "density" in message:
                state.density = max(0.1, min(2.0, float(message["density"])))

            await self.send_json(
                client_id,
                {
                    "type": "settings_updated",
                    "settings": {
                        "fps": state.target_fps,
                        "mode": state.requested_mode,
                        "resolution": state.requested_resolution,
                        "brightness": state.brightness,
                        "contrast": state.contrast,
                        "gamma": state.gamma,
                        "density": state.density,
                    },
                },
            )

        elif msg_type == "frame_ack":
            state.frame_ack = message.get("frame", state.frame_ack)

        elif msg_type == "ping":
            state.last_ping = time.time()
            await self.send_json(client_id, {"type": "pong"})

        elif msg_type == "get_status":
            await self.send_json(
                client_id,
                {
                    "type": "status_info",
                    "playing": state.is_playing,
                    "paused": state.paused,
                    "current_frame": state.current_frame,
                    "target_fps": state.target_fps,
                },
            )

    async def stream_frame(self, client_id: str, frame_data: dict, frame_stats: dict):
        """Send a frame to a specific client with stats."""
        state = self.states.get(client_id)
        if not state or not state.is_playing:
            return

        # Attach performance stats
        frame_data["stats"] = frame_stats

        await self.send_json(client_id, frame_data)
        state.current_frame = frame_data.get("frame", state.current_frame)

    def get_all_states(self) -> Dict[str, Any]:
        """Get the state of all connections for monitoring."""
        return {
            "connections": len(self.connections),
            "clients": [
                {
                    "id": cid,
                    "playing": state.is_playing,
                    "current_frame": state.current_frame,
                    "fps": state.target_fps,
                    "mode": state.requested_mode,
                }
                for cid, state in self.states.items()
            ],
        }
