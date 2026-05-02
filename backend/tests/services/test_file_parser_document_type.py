import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.services.file_parser import FileParserService


def detect(filename: str) -> str:
    extension = Path(filename).suffix.lower().lstrip(".")
    return FileParserService._detect_type(filename, extension)


@pytest.mark.parametrize(
    ("filename", "expected"),
    [
        ("PL-001.pdf", "packing_list"),
        ("\u88c5\u7bb1\u5355.xlsx", "packing_list"),
        ("BL-MAEU.pdf", "bill_of_lading"),
        ("B_L_001.pdf", "bill_of_lading"),
        ("SO-001.pdf", "shipping_instruction"),
        ("Booking Confirmation.pdf", "shipping_instruction"),
    ],
)
def test_detect_type_uses_document_classifier(filename, expected):
    assert detect(filename) == expected


@pytest.mark.parametrize(
    ("filename", "expected"),
    [
        ("CI-001.pdf", "invoice"),
        ("PO-001.pdf", "po"),
    ],
)
def test_detect_type_keeps_existing_invoice_and_po_behavior(filename, expected):
    assert detect(filename) == expected


def test_detect_type_unknown_filename_uses_extension_fallback():
    detected_type = detect("random123.pdf")

    assert detected_type == "pdf"
    assert detected_type not in {
        "packing_list",
        "bill_of_lading",
        "shipping_instruction",
        "invoice",
        "po",
    }


def test_detect_type_logs_classifier_legacy_and_fallback_sources(caplog):
    caplog.set_level("INFO")

    assert detect("PL-001.pdf") == "packing_list"
    assert detect("Commercial.pdf") == "invoice"
    assert detect("random123.pdf") == "pdf"

    messages = [record.getMessage() for record in caplog.records]
    assert any("source=classifier type=packing_list" in message for message in messages)
    assert any("source=legacy type=invoice" in message for message in messages)
    assert any("source=fallback type=pdf" in message for message in messages)
