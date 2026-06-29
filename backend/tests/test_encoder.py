"""Unit tests for DeltaEncoder."""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from video_processor.converter import Cell
from video_processor.encoder import DeltaEncoder


def make_cells(width: int = 5, height: int = 5, char: str = "█", color: str = "#ffffff"):
    """Helper to create a grid of cells."""
    cells = []
    for y in range(height):
        for x in range(width):
            cells.append(Cell(x=x, y=y, char=char, color=color))
    return cells


def test_first_frame_is_keyframe():
    """Test that the first encoded frame has is_keyframe=True."""
    encoder = DeltaEncoder()
    cells = make_cells(10, 10)
    result = encoder.encode(cells)
    assert result["is_keyframe"] is True
    assert len(result["cells"]) == 100


def test_identical_frames_produce_no_changes():
    """Test that identical frames produce no changed cells."""
    encoder = DeltaEncoder()
    cells = make_cells(10, 10)
    encoder.encode(cells)  # first frame
    result = encoder.encode(cells)  # second frame (identical)
    assert len(result["cells"]) == 0, "Identical frames should produce no changed cells"


def test_single_cell_change():
    """Test that changing one cell produces exactly one diff."""
    encoder = DeltaEncoder()
    cells1 = make_cells(5, 5, char="█", color="#ffffff")
    encoder.encode(cells1)  # keyframe

    # Change one cell
    cells2 = make_cells(5, 5, char="█", color="#ffffff")
    cells2[12] = Cell(x=2, y=2, char=" ", color="#000000")
    result = encoder.encode(cells2)
    assert len(result["cells"]) == 1
    assert result["cells"][0]["x"] == 2
    assert result["cells"][0]["y"] == 2
    assert result["cells"][0]["char"] == " "


def test_color_change_detected():
    """Test that color changes are detected as diffs."""
    encoder = DeltaEncoder()
    cells1 = make_cells(5, 5, char="█", color="#ff0000")
    encoder.encode(cells1)

    cells2 = make_cells(5, 5, char="█", color="#00ff00")
    result = encoder.encode(cells2)
    assert len(result["cells"]) == 25, "All cells changed color"


def test_force_keyframe():
    """Test that force_keyframe sends all cells."""
    encoder = DeltaEncoder()
    cells1 = make_cells(3, 3)
    encoder.encode(cells1)

    cells2 = make_cells(3, 3)
    result = encoder.encode(cells2, force_keyframe=True)
    assert result["is_keyframe"] is True
    assert len(result["cells"]) == 9, "Forced keyframe should send all cells"


def test_compression_ratio_identical_frames():
    """Test compression ratio with identical frames."""
    encoder = DeltaEncoder()
    cells = make_cells(10, 10)
    encoder.encode(cells)  # keyframe: 100 cells sent
    encoder.encode(cells)  # delta: 0 cells sent
    # Total possible: 200, total sent: 100, ratio: 2.0
    ratio = encoder.get_compression_ratio()
    assert ratio == 2.0, f"Expected 2.0, got {ratio}"


def test_compression_ratio_changing_frames():
    """Test compression ratio with changing frames."""
    encoder = DeltaEncoder()
    cells1 = make_cells(10, 10)
    encoder.encode(cells1)  # keyframe: 100 cells
    cells2 = make_cells(10, 10)
    cells2[0] = Cell(x=0, y=0, char=" ", color="#000000")
    encoder.encode(cells2)  # delta: 1 cell
    # 100 + 1 = 101 sent over 200 possible = ~1.98 ratio
    ratio = encoder.get_compression_ratio()
    assert 1.9 < ratio < 2.1, f"Expected ~1.98, got {ratio}"


def test_reset_clears_state():
    """Test that reset clears the encoder state."""
    encoder = DeltaEncoder()
    cells = make_cells(5, 5)
    encoder.encode(cells)
    assert encoder.frame_count == 1
    encoder.reset()
    assert encoder.frame_count == 0
    assert encoder.previous_frame is None

    # After reset, next frame should be keyframe
    result = encoder.encode(cells)
    assert result["is_keyframe"] is True


def test_get_stats():
    """Test that get_stats returns correct structure."""
    encoder = DeltaEncoder()
    cells = make_cells(10, 10)
    encoder.encode(cells)
    encoder.encode(cells)
    stats = encoder.get_stats()
    assert stats["frames_encoded"] == 2
    assert stats["total_cells_possible"] == 200
    assert stats["total_cells_sent"] == 100  # keyframe only
    assert "compression_ratio" in stats
    assert "savings_percent" in stats


def test_different_grid_sizes():
    """Test that encoder handles different grid sizes."""
    encoder = DeltaEncoder()
    cells1 = make_cells(5, 5)
    encoder.encode(cells1)

    cells2 = make_cells(10, 10)  # bigger grid
    result = encoder.encode(cells2)
    # 75 new positions (100 - 25 overlapping that remain the same)
    assert len(result["cells"]) == 75, f"Expected 75 changed cells, got {len(result['cells'])}"


if __name__ == "__main__":
    test_first_frame_is_keyframe()
    test_identical_frames_produce_no_changes()
    test_single_cell_change()
    test_color_change_detected()
    test_force_keyframe()
    test_compression_ratio_identical_frames()
    test_compression_ratio_changing_frames()
    test_reset_clears_state()
    test_get_stats()
    test_different_grid_sizes()
    print("All encoder tests passed!")
