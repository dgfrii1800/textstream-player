"""Delta compression encoder for frame data.

Only transmits cells that changed from the previous frame,
achieving significant bandwidth savings for video content.
"""

from typing import Dict, List, Optional, Tuple

from .converter import Cell


class DeltaEncoder:
    """Compresses frame data by encoding only delta (changed) cells."""

    def __init__(self):
        self.previous_frame: Optional[Dict[Tuple[int, int], Cell]] = None
        self.frame_count: int = 0
        self.total_cells_sent: int = 0
        self.total_cells_possible: int = 0

    def reset(self):
        """Reset the encoder state for a new video."""
        self.previous_frame = None
        self.frame_count = 0
        self.total_cells_sent = 0
        self.total_cells_possible = 0

    def encode(self, cells: List[Cell], force_keyframe: bool = False) -> dict:
        """Encode cells using delta compression.

        Args:
            cells: List of Cell objects for the current frame.
            force_keyframe: If True, send all cells (keyframe).

        Returns:
            Dict with frame data including only changed cells.
        """
        current_frame: Dict[Tuple[int, int], Cell] = {}
        for cell in cells:
            current_frame[(cell.x, cell.y)] = cell

        changed_cells: List[Cell] = []
        removed_positions: List[Tuple[int, int]] = []

        if force_keyframe or self.previous_frame is None:
            # Send all cells as keyframe
            changed_cells = cells
        else:
            # Find changed cells (added, modified, or removed)
            for pos, cell in current_frame.items():
                prev = self.previous_frame.get(pos)
                if prev is None or prev.char != cell.char or prev.color != cell.color or prev.bg_color != cell.bg_color:
                    changed_cells.append(cell)

            # Find removed cells (in previous but not in current)
            for pos in self.previous_frame:
                if pos not in current_frame:
                    removed_positions.append(pos)

        self.previous_frame = current_frame
        self.frame_count += 1
        self.total_cells_sent += len(changed_cells) + len(removed_positions)
        self.total_cells_possible += len(cells)

        result = {
            "frame": self.frame_count,
            "is_keyframe": force_keyframe or self.frame_count == 1,
            "cells": [c.to_dict() for c in changed_cells],
        }

        if removed_positions:
            result["removed"] = [{"x": x, "y": y} for x, y in removed_positions]

        if self.previous_frame and len(current_frame) > 0:
            # Include grid dimensions from first cell's perspective
     #       first_cell = next(iter(current_frame.values()))
            result["width"] = max(p[0] for p in current_frame) + 1
            result["height"] = max(p[1] for p in current_frame) + 1

        return result

    def get_compression_ratio(self) -> float:
        """Get the compression ratio achieved."""
        if self.total_cells_possible == 0:
            return 1.0
        if self.total_cells_sent == 0:
            return float("inf")
        return self.total_cells_possible / self.total_cells_sent

    def get_stats(self) -> dict:
        """Get compression statistics."""
        return {
            "frames_encoded": self.frame_count,
            "total_cells_possible": self.total_cells_possible,
            "total_cells_sent": self.total_cells_sent,
            "compression_ratio": round(self.get_compression_ratio(), 2),
            "savings_percent": round(
                (1 - self.total_cells_sent / max(1, self.total_cells_possible)) * 100, 1
            ),
        }
