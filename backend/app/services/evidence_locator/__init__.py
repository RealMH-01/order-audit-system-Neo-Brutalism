"""Evidence location helpers for mapping parsed findings back to source files."""

from app.services.evidence_locator.cell_index import build_cell_index, normalize_merged_cell

__all__ = ["build_cell_index", "normalize_merged_cell"]
