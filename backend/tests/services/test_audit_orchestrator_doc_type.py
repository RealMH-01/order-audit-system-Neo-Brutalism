import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.services.audit_orchestrator import AuditOrchestratorService


def resolve(
    *,
    filename: str,
    detected_type: str | None = None,
    manual_type: str | None = None,
) -> str:
    service = AuditOrchestratorService.__new__(AuditOrchestratorService)
    return service._resolve_doc_type(
        manual_type,
        {
            "filename": filename,
            "detected_type": detected_type,
        },
    )


@pytest.mark.parametrize(
    ("detected_type", "filename", "expected"),
    [
        ("pdf", "PL-001.pdf", "packing_list"),
        ("xlsx", "\u88c5\u7bb1\u5355.xlsx", "packing_list"),
        ("other", "BL-MAEU.pdf", "bill_of_lading"),
    ],
)
def test_resolve_doc_type_uses_filename_classifier_for_fallback_types(detected_type, filename, expected):
    assert resolve(detected_type=detected_type, filename=filename) == expected


def test_resolve_doc_type_preserves_explicit_manual_type():
    assert resolve(manual_type="invoice", detected_type="pdf", filename="PL-001.pdf") == "invoice"


def test_resolve_doc_type_ignores_manual_extension_fallback_type():
    assert resolve(manual_type="xlsm", detected_type="pdf", filename="PL-001.pdf") == "packing_list"


def test_resolve_doc_type_returns_detected_business_type():
    assert (
        resolve(detected_type="shipping_instruction", filename="random123.pdf")
        == "shipping_instruction"
    )


def test_resolve_doc_type_uses_filename_classifier_for_xlsm_detected_type():
    assert resolve(detected_type="xlsm", filename="PL-001.xlsm") == "packing_list"


@pytest.mark.parametrize("detected_type", ["pdf", "other", "csv"])
def test_resolve_doc_type_unknown_falls_back_to_generic(detected_type):
    extension = "csv" if detected_type == "csv" else "pdf"
    assert resolve(manual_type="", detected_type=detected_type, filename=f"random123.{extension}") == "generic"
