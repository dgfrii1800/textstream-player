"""Frame-to-text converter with multiple rendering modes."""

from enum import Enum
from typing import List, Optional

import numpy as np


class RenderingMode(str, Enum):
    ASCII = "ascii"
    UNICODE = "unicode"
    BRAILLE = "braille"
    ANSI = "ansi"


class ColorMode(str, Enum):
    FULL_RGB = "full_rgb"
    ANSI_256 = "ansi_256"
    GRAYSCALE = "grayscale"
    MONOCHROME = "monochrome"


# ASCII characters ordered by brightness (dark to light)
ASCII_CHARS = "@%#*+=-:. "

# Unicode block characters for higher quality
UNICODE_BLOCKS = {
    "full": "█",
    "dark": "▓",
    "medium": "▒",
    "light": "░",
    "top": "▀",
    "bottom": "▄",
    "left": "▌",
    "right": "▐",
}

# Braille base
BRAILLE_BASE = 0x2800

# ANSI 256-color palette (6x6x6 cube + grayscale)
ANSI_256_COLORS = [
    (0, 0, 0), (128, 0, 0), (0, 128, 0), (128, 128, 0),
    (0, 0, 128), (128, 0, 128), (0, 128, 128), (192, 192, 192),
    (128, 128, 128), (255, 0, 0), (0, 255, 0), (255, 255, 0),
    (0, 0, 255), (255, 0, 255), (0, 255, 255), (255, 255, 255),
]


class Cell:
    """Represents a single cell in the text grid."""

    def __init__(self, x: int, y: int, char: str, color: str, bg_color: Optional[str] = None):
        self.x = x
        self.y = y
        self.char = char
        self.color = color
        self.bg_color = bg_color

    def to_dict(self) -> dict:
        d = {"x": self.x, "y": self.y, "char": self.char, "color": self.color}
        if self.bg_color:
            d["bg_color"] = self.bg_color
        return d


class FrameConverter:
    """Converts numpy frame arrays into text grid cells."""

    def __init__(
        self,
        mode: RenderingMode = RenderingMode.UNICODE,
        color_mode: ColorMode = ColorMode.FULL_RGB,
        brightness: float = 1.0,
        contrast: float = 1.0,
        gamma: float = 1.0,
        density: float = 1.0,
    ):
        self.mode = mode
        self.color_mode = color_mode
        self.brightness = brightness
        self.contrast = contrast
        self.gamma = gamma
        self.density = density

    def _adjust_pixels(self, frame: np.ndarray) -> np.ndarray:
        """Apply brightness, contrast, and gamma adjustments."""
        img = frame.astype(np.float32)
        # Brightness
        img = img * self.brightness
        # Contrast
        img = ((img - 128) * self.contrast) + 128
        # Gamma
        if self.gamma != 1.0:
            img = np.power(np.clip(img / 255.0, 0, 1), 1.0 / self.gamma) * 255.0
        return np.clip(img, 0, 255).astype(np.uint8)

    def _get_brightness(self, frame: np.ndarray) -> np.ndarray:
        """Convert frame to brightness values (0-255)."""
        gray = np.dot(frame[..., :3], [0.299, 0.587, 0.114])
        return np.clip(gray, 0, 255).astype(np.uint8)

    def _rgb_to_hex(self, r: int, g: int, b: int) -> str:
        return f"#{r:02x}{g:02x}{b:02x}"

    def _get_ansi_256_color(self, r: int, g: int, b: int) -> str:
        """Map RGB to closest ANSI 256-color code."""
        best_dist = float("inf")
        best_idx = 0
        for i, (cr, cg, cb) in enumerate(ANSI_256_COLORS):
            dist = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2
            if dist < best_dist:
                best_dist = dist
                best_idx = i
        return str(best_idx)

    def convert_ascii(self, frame: np.ndarray) -> List[Cell]:
        """Convert frame to ASCII art."""
        gray = self._get_brightness(frame)
        height, width = gray.shape
        cells = []
        num_chars = len(ASCII_CHARS)

        for y in range(height):
            for x in range(width):
                brightness_val = gray[y, x]
                char_idx = int((brightness_val / 255.0) * (num_chars - 1))
                char_idx = min(char_idx, num_chars - 1)
                char = ASCII_CHARS[char_idx]

                if self.color_mode == ColorMode.MONOCHROME:
                    color = "#ffffff"
                elif self.color_mode == ColorMode.GRAYSCALE:
                    c = int(brightness_val)
                    color = self._rgb_to_hex(c, c, c)
                else:
                    r, g, b = frame[y, x]
                    color = self._rgb_to_hex(int(r), int(g), int(b))

                cells.append(Cell(x=x, y=y, char=char, color=color))

        return cells

    def convert_unicode(self, frame: np.ndarray) -> List[Cell]:
        """Convert frame to Unicode block characters for higher quality."""
        adjusted = self._adjust_pixels(frame)
        height, width = adjusted.shape[:2]
        cells = []

        # Group into 2x1 blocks (each char represents 2 vertical pixels)
        for y in range(0, height, 2):
            for x in range(width):
                top_pixel = adjusted[y, x]
                if y + 1 < height:
                    bottom_pixel = adjusted[y + 1, x]
                else:
                    bottom_pixel = top_pixel

                top_bright = np.dot(top_pixel[:3], [0.299, 0.587, 0.114])
                bottom_bright = np.dot(bottom_pixel[:3], [0.299, 0.587, 0.114])

                # Choose character based on brightness of top vs bottom
                avg_bright = (top_bright + bottom_bright) / 2

                if top_bright > 200 and bottom_bright > 200:
                    char = " "  # both bright - empty
                elif top_bright < 55 and bottom_bright < 55:
                    char = "█"  # both dark - full block
                elif top_bright > bottom_bright:
                    char = "▄"  # bottom half
                else:
                    char = "▀"  # top half

                # Color based on average of the block
                r = int((int(top_pixel[0]) + int(bottom_pixel[0])) / 2)
                g = int((int(top_pixel[1]) + int(bottom_pixel[1])) / 2)
                b = int((int(top_pixel[2]) + int(bottom_pixel[2])) / 2)

                color = self._rgb_to_hex(r, g, b) if self.color_mode != ColorMode.MONOCHROME else "#ffffff"

                cells.append(Cell(x=x, y=y // 2, char=char, color=color))

        return cells

    def convert_braille(self, frame: np.ndarray) -> List[Cell]:
        """Convert frame to Braille characters (2x4 pixels per character)."""
        adjusted = self._adjust_pixels(frame)
        height, width = adjusted.shape[:2]
        cells = []

        for y in range(0, height, 4):
            for x in range(0, width, 2):
                if x >= width or y >= height:
                    continue

                braille_bits = 0
                r_sum, g_sum, b_sum = 0, 0, 0
                pixel_count = 0

                # Braille dots: 2 columns x 4 rows = 8 dots
                # Dot layout in Unicode:
                # 0 3
                # 1 4
                # 2 5
                # 6 7
                dot_positions = [
                    (0, 0), (0, 1), (0, 2), (1, 0),
                    (1, 1), (1, 2), (0, 3), (1, 3),
                ]

                for dot_idx, (dx, dy) in enumerate(dot_positions):
                    px = x + dx
                    py = y + dy
                    if px < width and py < height:
                        pixel = adjusted[py, px]
                        bright = np.dot(pixel[:3], [0.299, 0.587, 0.114])
                        # Dot is "on" if brightness is below threshold
                        threshold = 128 * (2.0 - self.density)
                        if bright < threshold:
                            braille_bits |= (1 << dot_idx)
                        r_sum += int(pixel[0])
                        g_sum += int(pixel[1])
                        b_sum += int(pixel[2])
                        pixel_count += 1

                if braille_bits == 0:
                    char = " "
                else:
                    char = chr(BRAILLE_BASE + braille_bits)

                if pixel_count > 0:
                    r = r_sum // pixel_count
                    g = g_sum // pixel_count
                    b = b_sum // pixel_count
                    color = self._rgb_to_hex(r, g, b) if self.color_mode != ColorMode.MONOCHROME else "#ffffff"
                else:
                    color = "#000000"

                cells.append(Cell(x=x // 2, y=y // 4, char=char, color=color))

        return cells

    def convert_ansi(self, frame: np.ndarray) -> List[Cell]:
        """Convert frame to ANSI terminal art with fg/bg colors."""
        adjusted = self._adjust_pixels(frame)
        height, width = adjusted.shape[:2]
        cells = []

        for y in range(0, height, 2):
            for x in range(width):
                fg_pixel = adjusted[y, x]
                if y + 1 < height:
                    bg_pixel = adjusted[y + 1, x]
                else:
                    bg_pixel = fg_pixel

                fg_bright = np.dot(fg_pixel[:3], [0.299, 0.587, 0.114])
                bg_bright = np.dot(bg_pixel[:3], [0.299, 0.587, 0.114])

                # Upper block by default
                char = "▀"

                if self.color_mode == ColorMode.ANSI_256:
                    fg_color = self._get_ansi_256_color(int(fg_pixel[0]), int(fg_pixel[1]), int(fg_pixel[2]))
                    bg_color = self._get_ansi_256_color(int(bg_pixel[0]), int(bg_pixel[1]), int(bg_pixel[2]))
                else:
                    fg_color = self._rgb_to_hex(int(fg_pixel[0]), int(fg_pixel[1]), int(fg_pixel[2]))
                    bg_color = self._rgb_to_hex(int(bg_pixel[0]), int(bg_pixel[1]), int(bg_pixel[2]))

                if self.color_mode == ColorMode.MONOCHROME:
                    fg_color = "#ffffff"
                    bg_color = "#000000"

                cells.append(Cell(x=x, y=y // 2, char=char, color=fg_color, bg_color=bg_color))

        return cells

    def convert_frame(self, frame: np.ndarray) -> List[Cell]:
        """Convert a frame to text cells using the configured mode."""
        if self.mode == RenderingMode.ASCII:
            return self.convert_ascii(frame)
        elif self.mode == RenderingMode.UNICODE:
            return self.convert_unicode(frame)
        elif self.mode == RenderingMode.BRAILLE:
            return self.convert_braille(frame)
        elif self.mode == RenderingMode.ANSI:
            return self.convert_ansi(frame)
        else:
            return self.convert_unicode(frame)


class FrameData:
    """Represents a processed frame ready for transmission."""

    def __init__(
        self,
        frame_number: int,
        width: int,
        height: int,
        cells: List[Cell],
        mode: str = "unicode",
    ):
        self.frame_number = frame_number
        self.width = width
        self.height = height
        self.cells = cells
        self.mode = mode

    def to_dict(self) -> dict:
        return {
            "frame": self.frame_number,
            "width": self.width,
            "height": self.height,
            "mode": self.mode,
            "cells": [c.to_dict() for c in self.cells],
        }
