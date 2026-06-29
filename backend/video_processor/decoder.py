"""Video decoder using FFmpeg subprocess to extract frames."""

import asyncio
import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import AsyncGenerator, Optional

import numpy as np
from PIL import Image


class VideoDecoder:
    """Decodes video files into frames using FFmpeg."""

    FFMPEG_PATH: str = ""
    SUPPORTED_FORMATS = {".mp4", ".mkv", ".avi", ".mov", ".webm", ".gif"}

    def __init__(self, video_path: str, ffmpeg_path: str = ""):
        self.video_path = video_path
        self.metadata: dict = {}
        self.total_frames: int = 0
        self.fps: float = 0.0
        self.duration: float = 0.0
        self.width: int = 0
        self.height: int = 0
        if ffmpeg_path:
            self.__class__.FFMPEG_PATH = ffmpeg_path

    @classmethod
    def find_ffmpeg(cls) -> str:
        """Find ffmpeg binary."""
        if cls.FFMPEG_PATH:
            return cls.FFMPEG_PATH
        # Check common locations
        candidates = [
            "/tmp/ffmpeg",
            "/usr/bin/ffmpeg",
            "/usr/local/bin/ffmpeg",
            "ffmpeg",
        ]
        for c in candidates:
            try:
                result = subprocess.run(
                    [c, "-version"], capture_output=True, text=True, timeout=5
                )
                if result.returncode == 0:
                    cls.FFMPEG_PATH = c
                    return c
            except (FileNotFoundError, subprocess.TimeoutExpired):
                continue
        raise FileNotFoundError("FFmpeg not found. Install FFmpeg and set FFMPEG_PATH.")

    def read_metadata(self) -> dict:
        """Read video metadata using ffprobe."""
        ffmpeg = self.find_ffmpeg()
        ffprobe = ffmpeg.replace("ffmpeg", "ffprobe")
        if ffprobe == ffmpeg:
            ffprobe = "ffprobe"

        cmd = [
            ffprobe,
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            self.video_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        data = json.loads(result.stdout)

        video_stream = None
        for stream in data.get("streams", []):
            if stream.get("codec_type") == "video":
                video_stream = stream
                break

        if video_stream:
            self.width = int(video_stream.get("width", 0))
            self.height = int(video_stream.get("height", 0))
            self.fps = self._parse_fps(video_stream.get("r_frame_rate", "0"))
            self.duration = float(video_stream.get("duration", 0) or data.get("format", {}).get("duration", 0))
            self.total_frames = int(self.fps * self.duration) if self.fps > 0 else 0

        self.metadata = {
            "width": self.width,
            "height": self.height,
            "fps": self.fps,
            "duration": self.duration,
            "total_frames": self.total_frames,
            "codec": (video_stream or {}).get("codec_name", ""),
            "size": os.path.getsize(self.video_path),
            "format": Path(self.video_path).suffix.lower(),
        }
        return self.metadata

    @staticmethod
    def _parse_fps(fps_str: str) -> float:
        try:
            if "/" in fps_str:
                num, den = fps_str.split("/")
                return float(num) / float(den) if float(den) > 0 else 0.0
            return float(fps_str)
        except (ValueError, ZeroDivisionError):
            return 0.0

    async def extract_frames(
        self,
        target_width: int = 200,
        target_height: int = 112,
        target_fps: Optional[float] = None,
        max_frames: Optional[int] = None,
    ) -> AsyncGenerator[np.ndarray, None]:
        """Extract frames as numpy arrays asynchronously."""
        ffmpeg = self.find_ffmpeg()
        fps = target_fps or self.fps

        cmd = [
            ffmpeg,
            "-i", self.video_path,
            "-vf", f"fps={fps},scale={target_width}:{target_height}:flags=bilinear",
            "-f", "image2pipe",
            "-vcodec", "rawvideo",
            "-pix_fmt", "rgb24",
            "-",
        ]

        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        frame_size = target_width * target_height * 3
        frame_count = 0

        try:
            while True:
                if max_frames and frame_count >= max_frames:
                    process.terminate()
                    break

                raw_data = await process.stdout.read(frame_size)
                if not raw_data or len(raw_data) < frame_size:
                    break

                frame = np.frombuffer(raw_data[:frame_size], dtype=np.uint8).reshape(
                    (target_height, target_width, 3)
                )
                frame_count += 1
                yield frame
        finally:
            if process.returncode is None:
                process.terminate()
                await process.wait()

    async def extract_frame_at_time(
        self, time_sec: float, target_width: int = 200, target_height: int = 112
    ) -> Optional[np.ndarray]:
        """Extract a single frame at a given timestamp."""
        ffmpeg = self.find_ffmpeg()

        cmd = [
            ffmpeg,
            "-ss", str(time_sec),
            "-i", self.video_path,
            "-vframes", "1",
            "-vf", f"scale={target_width}:{target_height}:flags=bilinear",
            "-f", "rawvideo",
            "-pix_fmt", "rgb24",
            "-",
        ]

        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        frame_size = target_width * target_height * 3
        raw_data, _ = await process.communicate()

        if not raw_data or len(raw_data) < frame_size:
            return None

        return np.frombuffer(raw_data[:frame_size], dtype=np.uint8).reshape(
            (target_height, target_width, 3)
        )
