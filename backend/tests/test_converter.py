"""Unit tests for FrameConverter."""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import math
import numpy as np
from video_processor.converter import FrameConverter, RenderingMode, ColorMode


def test_ascii_mode_returns_cells():
    """Test that ASCII mode returns cells with correct structure."""
    frame = np.zeros((100, 200, 3), dtype=np.uint8)
    converter = FrameConverter(mode=RenderingMode.ASCII)
    cells = converter.convert_frame(frame)
    assert len(cells) > 0
    for cell in cells[:5]:
        assert hasattr(cell, "x")
        assert hasattr(cell, "y")
        assert hasattr(cell, "char")
        assert hasattr(cell, "color")
        assert cell.char in "@%#*+=-:. "


def test_ascii_mode_dark_frame():
    """Test that a dark frame produces dense characters."""
    frame = np.zeros((100, 200, 3), dtype=np.uint8)
    converter = FrameConverter(mode=RenderingMode.ASCII)
    cells = converter.convert_frame(frame)
    # Dark pixels should map to dense chars (e.g., @ or %)
    dense_chars = {"@", "%", "#"}
    found_dense = any(c.char in dense_chars for c in cells[:100])
    assert found_dense, "Dark frame should produce dense ASCII chars"


def test_ascii_mode_bright_frame():
    """Test that a bright frame produces sparse characters."""
    frame = np.full((100, 200, 3), 255, dtype=np.uint8)
    converter = FrameConverter(mode=RenderingMode.ASCII)
    cells = converter.convert_frame(frame)
    # Bright pixels should map to sparse chars (e.g., space or .)
    sparse_chars = {" ", ".", ":"}
    found_sparse = any(c.char in sparse_chars for c in cells[:100])
    assert found_sparse, "Bright frame should produce sparse ASCII chars"


def test_unicode_mode_returns_cells():
    """Test that Unicode mode returns cells with block characters."""
    frame = np.zeros((100, 200, 3), dtype=np.uint8)
    converter = FrameConverter(mode=RenderingMode.UNICODE)
    cells = converter.convert_frame(frame)
    assert len(cells) > 0
    block_chars = {"█", "▀", "▄", " "}
    for cell in cells[:20]:
        assert cell.char in block_chars, f"Unexpected char: {cell.char}"


def test_braille_mode_returns_cells():
    """Test that Braille mode returns Braille Unicode characters."""
    frame = np.zeros((100, 200, 3), dtype=np.uint8)
    converter = FrameConverter(mode=RenderingMode.BRAILLE)
    cells = converter.convert_frame(frame)
    assert len(cells) > 0
    # Braille chars start at U+2800
    for cell in cells[:20]:
        if cell.char != " ":
            code = ord(cell.char)
            assert 0x2800 <= code <= 0x28FF, f"Not a Braille char: {hex(code)}"


def test_ansi_mode_returns_cells():
    """Test that ANSI mode returns cells with background colors."""
    frame = np.zeros((100, 200, 3), dtype=np.uint8)
    converter = FrameConverter(mode=RenderingMode.ANSI)
    cells = converter.convert_frame(frame)
    assert len(cells) > 0
    for cell in cells[:10]:
        assert cell.char == "▀"
        assert cell.bg_color is not None, "ANSI cells should have bg_color"


def test_full_rgb_color_output():
    """Test that full RGB mode outputs hex colors."""
    frame = np.zeros((10, 10, 3), dtype=np.uint8)
    frame[:, :] = [255, 128, 64]
    converter = FrameConverter(mode=RenderingMode.ASCII, color_mode=ColorMode.FULL_RGB)
    cells = converter.convert_frame(frame)
    for cell in cells[:5]:
        assert cell.color.startswith("#")
        assert len(cell.color) == 7


def test_monochrome_mode():
    """Test that monochrome mode outputs white."""
    frame = np.random.randint(0, 255, (50, 50, 3), dtype=np.uint8)
    converter = FrameConverter(mode=RenderingMode.ASCII, color_mode=ColorMode.MONOCHROME)
    cells = converter.convert_frame(frame)
    for cell in cells[:5]:
        assert cell.color == "#ffffff", "Monochrome should output white"


def test_grayscale_mode():
    """Test that grayscale mode outputs gray hex colors."""
    frame = np.random.randint(0, 255, (50, 50, 3), dtype=np.uint8)
    converter = FrameConverter(mode=RenderingMode.ASCII, color_mode=ColorMode.GRAYSCALE)
    cells = converter.convert_frame(frame)
    for cell in cells[:5]:
        r, g, b = int(cell.color[1:3], 16), int(cell.color[3:5], 16), int(cell.color[5:7], 16)
        assert r == g == b, f"Grayscale should have equal R, G, B but got #{cell.color}"


def test_brightness_adjustment_darkens():
    """Test that low brightness darkens the output."""
    frame = np.full((10, 10, 3), 128, dtype=np.uint8)
    converter_high = FrameConverter(mode=RenderingMode.ASCII, brightness=2.0)
    converter_low = FrameConverter(mode=RenderingMode.ASCII, brightness=0.1)
    cells_high = converter_high.convert_frame(frame)
    cells_low = converter_low.convert_frame(frame)
    # Low brightness should produce darker (denser) chars than high brightness
    bright_avg = sum(ord(c.char) for c in cells_high) / len(cells_high)
    dark_avg = sum(ord(c.char) for c in cells_low) / len(cells_low)
    # ASCII_CHARS = "@%#*+=-:. " – higher unicode values = darker in this charset
    assert dark_avg > bright_avg, "Lower brightness should produce denser (higher-code) chars"


def test_density_affects_braille():
    """Test that density affects Braille threshold."""
    frame = np.full((20, 20, 3), 100, dtype=np.uint8)  # mid-gray
    converter_low = FrameConverter(mode=RenderingMode.BRAILLE, density=0.2)
    converter_high = FrameConverter(mode=RenderingMode.BRAILLE, density=1.8)
    cells_low = converter_low.convert_frame(frame)
    cells_high = converter_high.convert_frame(frame)
    # Higher density = more dots on = different characters
    low_empty = sum(1 for c in cells_low if c.char == " ")
    high_empty = sum(1 for c in cells_high if c.char == " ")
    assert high_empty <= low_empty, "Higher density should produce fewer empty cells"


def test_cell_dimensions():
    """Test that cells have correct x,y coordinates."""
    frame = np.zeros((20, 40, 3), dtype=np.uint8)
    converter = FrameConverter(mode=RenderingMode.ASCII)
    cells = converter.convert_frame(frame)
    assert len(cells) == 20 * 40  # 1 pixel per cell in ASCII mode
    # Check coordinates
    coords = {(c.x, c.y) for c in cells}
    assert (0, 0) in coords
    assert (39, 19) in coords


def test_cell_to_dict():
    """Test that cell.to_dict() returns correct structure."""
    from video_processor.converter import Cell
    cell = Cell(x=5, y=10, char="█", color="#ff8800")
    d = cell.to_dict()
    assert d["x"] == 5
    assert d["y"] == 10
    assert d["char"] == "█"
    assert d["color"] == "#ff8800"
    assert "bg_color" not in d

    cell_with_bg = Cell(x=0, y=0, char="▀", color="#ffffff", bg_color="#000000")
    d2 = cell_with_bg.to_dict()
    assert d2["bg_color"] == "#000000"


def test_contrast_affects_char_distribution():
    """Test that contrast changes character distribution."""
    # Use varied pixel values so contrast has something to amplify/reduce
    rng = np.random.RandomState(42)
    frame = rng.randint(0, 256, (20, 20, 3), dtype=np.uint8)
    converter_low = FrameConverter(mode=RenderingMode.ASCII, contrast=0.1)
    converter_high = FrameConverter(mode=RenderingMode.ASCII, contrast=3.0)
    cells_low = converter_low.convert_frame(frame)
    cells_high = converter_high.convert_frame(frame)
    # Different contrast should produce different characters
    chars_low = {c.char for c in cells_low}
    chars_high = {c.char for c in cells_high}
    assert chars_low != chars_high, "Contrast should change character distribution"


if __name__ == "__main__":
    test_ascii_mode_returns_cells()
    test_ascii_mode_dark_frame()
    test_ascii_mode_bright_frame()
    test_unicode_mode_returns_cells()
    test_braille_mode_returns_cells()
    test_ansi_mode_returns_cells()
    test_full_rgb_color_output()
    test_monochrome_mode()
    test_grayscale_mode()
    test_brightness_adjustment_darkens()
    test_density_affects_braille()
    test_cell_dimensions()
    test_cell_to_dict()
    test_contrast_affects_brightness()
    print("All converter tests passed!")
