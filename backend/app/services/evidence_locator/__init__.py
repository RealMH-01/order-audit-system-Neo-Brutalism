"""Evidence location helpers for mapping parsed findings back to source files."""

from app.services.evidence_locator.cell_index import build_cell_index, normalize_merged_cell
from app.services.evidence_locator.field_aliases import FIELD_ALIASES, match_field
from app.services.evidence_locator.resolver import resolve_issue_locations

__all__ = [
    "FIELD_ALIASES",
    "build_cell_index",
    "match_field",
    "normalize_merged_cell",
    "resolve_issue_locations",
]
