import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import app.services.document_classifier as document_classifier
from app.services.document_classifier import (
    classify_by_content,
    classify_by_filename,
    detect_document_type,
    reload_rules,
)


@pytest.fixture(autouse=True)
def clear_document_type_cache():
    reload_rules()
    yield
    reload_rules()


@pytest.mark.parametrize(
    ("filename", "expected"),
    [
        ("CI.pdf", "invoice"),
        ("Commercial Invoice.pdf", "invoice"),
        ("INV-001.pdf", "invoice"),
    ],
)
def test_invoice_filename_detection(filename, expected):
    assert classify_by_filename(filename) == expected


@pytest.mark.parametrize(
    ("filename", "expected"),
    [
        ("PL-2024.pdf", "packing_list"),
        ("装箱单.xlsx", "packing_list"),
        ("PKL_test.pdf", "packing_list"),
    ],
)
def test_packing_list_filename_detection(filename, expected):
    assert classify_by_filename(filename) == expected


@pytest.mark.parametrize(
    ("filename", "expected"),
    [
        ("BL-MAEU.pdf", "bill_of_lading"),
        ("提单.pdf", "bill_of_lading"),
        ("B_L_001.pdf", "bill_of_lading"),
    ],
)
def test_bill_of_lading_filename_detection(filename, expected):
    assert classify_by_filename(filename) == expected


@pytest.mark.parametrize(
    ("filename", "expected"),
    [
        ("SO-001.pdf", "shipping_instruction"),
        ("托书.pdf", "shipping_instruction"),
        ("Booking Confirmation.pdf", "shipping_instruction"),
    ],
)
def test_shipping_instruction_filename_detection(filename, expected):
    assert classify_by_filename(filename) == expected


def test_unknown_filename_detection():
    assert detect_document_type("random123.pdf") == "other"
    assert classify_by_filename("random123.pdf") is None


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Commercial Invoice\nInvoice No: INV-001", "invoice"),
        ("Packing List\nCarton No: 1\nN.W. 10KG", "packing_list"),
        ("Bill of Lading\nShipper: A\nConsignee: B", "bill_of_lading"),
        ("Shipping Instruction\nBooking Confirmation", "shipping_instruction"),
    ],
)
def test_content_detection(text, expected):
    assert classify_by_content(text) == expected


def test_detect_document_type_prefers_filename_over_content():
    text = "Packing List\nCarton No: 1\nN.W. 10KG"

    assert detect_document_type("CI-001.pdf", text) == "invoice"


def test_detect_document_type_uses_content_when_filename_unknown():
    text = "Bill of Lading\nShipper: A\nConsignee: B"

    assert detect_document_type("scan001.pdf", text) == "bill_of_lading"


def test_detect_document_type_returns_other_when_no_match():
    assert detect_document_type("scan001.pdf", "plain scanned text") == "other"


def test_empty_inputs_do_not_error():
    assert classify_by_filename("") is None
    assert classify_by_content("") is None
    assert detect_document_type("", "") == "other"


def test_reload_rules_clears_cache(monkeypatch, tmp_path):
    config_path = tmp_path / "document_types.yaml"
    config_path.write_text(
        """
document_types:
  - type: alpha
    label: Alpha
    filename_keywords:
      - alpha
    content_keywords:
      - Alpha Document
    content_match_threshold: 1
""",
        encoding="utf-8",
    )
    monkeypatch.setattr(document_classifier, "CONFIG_PATH", config_path)
    reload_rules()

    assert classify_by_filename("alpha.pdf") == "alpha"

    config_path.write_text(
        """
document_types:
  - type: beta
    label: Beta
    filename_keywords:
      - beta
    content_keywords:
      - Beta Document
    content_match_threshold: 1
""",
        encoding="utf-8",
    )

    assert classify_by_filename("beta.pdf") is None

    reload_rules()

    assert classify_by_filename("beta.pdf") == "beta"
