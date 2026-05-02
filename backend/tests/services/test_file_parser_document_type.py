import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.services.file_parser import FileParserService


def make_parser_service() -> FileParserService:
    service = FileParserService.__new__(FileParserService)
    service.max_file_size_bytes = 20 * 1024 * 1024
    return service


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


def test_detect_type_logs_classifier_and_fallback_sources(caplog):
    caplog.set_level("INFO")

    assert detect("PL-001.pdf") == "packing_list"
    assert detect("CI-001.pdf") == "invoice"
    assert detect("random123.pdf") == "pdf"

    messages = [record.getMessage() for record in caplog.records]
    assert any("source=classifier type=packing_list" in message for message in messages)
    assert any("source=classifier type=invoice" in message for message in messages)
    assert any("source=fallback type=pdf" in message for message in messages)


def test_parse_file_uses_content_fallback_for_bill_of_lading(monkeypatch):
    service = make_parser_service()
    monkeypatch.setattr(
        service,
        "_parse_pdf",
        lambda *_: {
            "text": "Bill of Lading\nShipper\nConsignee",
            "page_count": 1,
            "source_kind": "pdf",
            "parse_mode": "pdf-text",
            "needs_ocr": False,
            "is_scanned_pdf": False,
            "page_images": [],
            "image_base64": None,
        },
    )

    parsed = service.parse_file(b"pdf", "scan001.pdf")

    assert parsed["detected_type"] == "bill_of_lading"


def test_parse_file_uses_content_fallback_for_packing_list(monkeypatch):
    service = make_parser_service()
    monkeypatch.setattr(
        service,
        "_parse_pdf",
        lambda *_: {
            "text": "Packing List\nCarton No\nN.W.",
            "page_count": 1,
            "source_kind": "pdf",
            "parse_mode": "pdf-text",
            "needs_ocr": False,
            "is_scanned_pdf": False,
            "page_images": [],
            "image_base64": None,
        },
    )

    parsed = service.parse_file(b"pdf", "doc.pdf")

    assert parsed["detected_type"] == "packing_list"


def test_parse_file_keeps_filename_detection_before_content(monkeypatch):
    service = make_parser_service()
    monkeypatch.setattr(
        "app.services.file_parser.classify_by_content",
        lambda *_: pytest.fail("content fallback should not run for filename matches"),
    )
    monkeypatch.setattr(
        service,
        "_parse_pdf",
        lambda *_: {
            "text": "Packing List\nCarton No\nN.W.",
            "page_count": 1,
            "source_kind": "pdf",
            "parse_mode": "pdf-text",
            "needs_ocr": False,
            "is_scanned_pdf": False,
            "page_images": [],
            "image_base64": None,
        },
    )

    parsed = service.parse_file(b"pdf", "CI-001.pdf")

    assert parsed["detected_type"] == "invoice"


def test_extract_text_for_classification_from_text():
    text = FileParserService._extract_text_for_classification(
        {"text": "Commercial Invoice\nInvoice No"}
    )

    assert "Commercial Invoice" in text
    assert "Invoice No" in text


def test_extract_text_for_classification_from_preview_text():
    text = FileParserService._extract_text_for_classification(
        {"preview_text": "Packing List\nCarton No\nN.W."}
    )

    assert "Packing List" in text
    assert "Carton No" in text


@pytest.mark.parametrize("payload", [{}, None])
def test_extract_text_for_classification_empty_inputs(payload):
    assert FileParserService._extract_text_for_classification(payload) == ""


def test_extract_text_for_classification_handles_list_and_dict_fields():
    text = FileParserService._extract_text_for_classification(
        {
            "content": {"title": "Bill of Lading", "metadata": {"ignored": "nested"}},
            "sheets": [{"name": "Sheet1", "rows": ["Shipper", "Consignee"]}],
            "page_images": ["not considered"],
        }
    )

    assert "Bill of Lading" in text
    assert "Sheet1" in text
    assert "Shipper" in text
    assert "not considered" not in text
