import re
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app.services.report_filename as report_filename
from app.services.report_filename import build_report_filename, pick_report_identifier


class FixedDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        return cls(2026, 4, 29, 17, 45, tzinfo=tz)


def test_build_report_filename_with_order_number(monkeypatch):
    monkeypatch.setattr(report_filename, "datetime", FixedDateTime)

    filename = build_report_filename("标记版", "SO2025001")

    assert filename == "审核标记版-SO2025001-20260429-1745.xlsx"


def test_build_report_filename_sanitizes_windows_illegal_chars(monkeypatch):
    monkeypatch.setattr(report_filename, "datetime", FixedDateTime)

    filename = build_report_filename("详情版", "PO/2025/001")

    assert filename == "审核详情版-PO_2025_001-20260429-1745.xlsx"


def test_build_report_filename_falls_back_when_identifier_empty(monkeypatch):
    monkeypatch.setattr(report_filename, "datetime", FixedDateTime)

    filename = build_report_filename("报告", "   ...  ", "zip")

    assert filename == "审核报告-未知-20260429-1745.zip"


def test_build_report_filename_truncates_identifier(monkeypatch):
    monkeypatch.setattr(report_filename, "datetime", FixedDateTime)
    long_identifier = "A" * 45

    filename = build_report_filename("标记版", long_identifier)

    assert filename == f"审核标记版-{'A' * 40}-20260429-1745.xlsx"


def test_build_report_filename_strips_edge_spaces(monkeypatch):
    monkeypatch.setattr(report_filename, "datetime", FixedDateTime)

    filename = build_report_filename("详情版", "  PO-001. ")

    assert filename == "审核详情版-PO-001-20260429-1745.xlsx"


def test_build_report_filename_timestamp_shape_without_clock_patch():
    filename = build_report_filename("标记版", "SO2025001")

    assert re.match(r"^审核标记版-SO2025001-\d{8}-\d{4}\.xlsx$", filename)


def test_pick_report_identifier_prefers_baseline_fields():
    identifier = pick_report_identifier(
        {
            "baseline_document": {
                "order_no": "SO2025001",
                "po_no": "PO2025001",
                "filename": "PO-fallback.xlsx",
            }
        },
        "12345678-abcd",
    )

    assert identifier == "SO2025001"


def test_pick_report_identifier_falls_back_to_first_uploaded_stem():
    identifier = pick_report_identifier(
        {"uploaded_files": [{"filename": "PO-2025-001.xlsx"}]},
        "12345678-abcd",
    )

    assert identifier == "PO-2025-001"
