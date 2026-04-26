"""Local diagnostic helper for Excel parsing and audit evidence extraction."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.config import Settings
from app.services.audit_orchestrator import AuditOrchestratorService
from app.services.file_parser import FileParserService
from app.services.runtime_store import RuntimeStore


def _parse_file(path: Path) -> dict[str, object]:
    parser = FileParserService(Settings(), RuntimeStore())
    return parser.parse_file(path.read_bytes(), path.name)


def _print_doc(label: str, parsed: dict[str, object], *, source: str) -> None:
    text = str(parsed.get("text", ""))
    fields = AuditOrchestratorService._extract_key_fields(text, source=source)
    print(f"{label} filename: {parsed.get('filename')}")
    print(f"{label} detected_type: {parsed.get('detected_type')}")
    print(f"{label} parsed text length: {len(text)}")
    print(f"{label} keyword hits: {AuditOrchestratorService._collect_diag_hits(text)}")
    print(f"{label} extracted fields: {fields}")
    print(f"{label} Unit Price: {fields.get('unit_price') or '未能确认'}")
    print(f"{label} Quantity: {fields.get('quantity') or '未能确认'}")
    print(f"{label} Amount: {fields.get('amount') or '未能确认'}")
    print(f"{label} parsed text first 3000 chars:")
    print(text[:3000])
    print()


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("Usage: python backend/scripts/diag_audit.py <po_xlsx_path> <target_xlsx_path>")
        return 2

    po_path = Path(argv[1]).expanduser().resolve()
    target_path = Path(argv[2]).expanduser().resolve()
    if not po_path.exists():
        print(f"PO file not found: {po_path}")
        return 1
    if not target_path.exists():
        print(f"Target file not found: {target_path}")
        return 1

    po_parsed = _parse_file(po_path)
    target_parsed = _parse_file(target_path)
    po_text = str(po_parsed.get("text", ""))
    target_text = str(target_parsed.get("text", ""))

    _print_doc("PO", po_parsed, source="po")
    _print_doc("Target", target_parsed, source="target")

    print("Evidence block:")
    print(AuditOrchestratorService._build_evidence_block(po_text, target_text) or "未能提取 evidence block")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
