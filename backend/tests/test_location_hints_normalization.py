from app.services.audit_engine import AuditEngineService, _normalize_location_hints
from app.services.evidence_locator.resolver import resolve_issue_locations


def _validated_issue(**overrides):
    raw_issue = {
        "id": "R-01",
        "level": "RED",
        "field_name": "invoice_no",
        "finding": "Invoice number mismatch.",
        "confidence": 0.9,
    }
    raw_issue.update(overrides)
    result = AuditEngineService()._validate_audit_result({"issues": [raw_issue]})
    return result["issues"][0]


def _cell(cell, value, *, sheet="Sheet1"):
    return {
        "file_id": "file-xlsx",
        "file_name": "CI-test.xlsx",
        "document_type": "invoice",
        "sheet": sheet,
        "cell": cell,
        "value_str": value,
        "left_label": "Invoice No.",
        "above_header": None,
        "merged_range": None,
    }


def _files():
    return {
        "file-xlsx": {
            "id": "file-xlsx",
            "filename": "CI-test.xlsx",
            "extension": "xlsx",
        }
    }


def _issue(**overrides):
    issue = {
        "id": "R-01",
        "level": "RED",
        "field_name": "Invoice No.",
        "finding": "Invoice value is wrong in invoice.",
        "your_value": "HR-EXP250401",
        "source_value": "HR-EXP250400",
        "document_type": "invoice",
        "file_id": "file-xlsx",
    }
    issue.update(overrides)
    return issue


def test_normalize_single_sheet_cell():
    assert _normalize_location_hints("Sheet1!F9") == ["Sheet1!F9"]


def test_normalize_list_strips_invalid_and_uppercases_cell():
    assert _normalize_location_hints(["sheet1!f9", " ", "x"]) == ["sheet1!F9"]


def test_normalize_sheet_name_with_space():
    assert _normalize_location_hints(["Sheet 1!F9"]) == ["Sheet 1!F9"]


def test_normalize_quoted_sheet_name():
    assert _normalize_location_hints(["'Sheet 1'!F9"]) == ["Sheet 1!F9"]


def test_normalize_rejects_range_without_sheet():
    assert _normalize_location_hints(["F9:F12"]) == []


def test_normalize_keeps_range_start_with_sheet():
    assert _normalize_location_hints(["INV!F9:F12"]) == ["INV!F9"]


def test_normalize_rejects_cell_without_sheet():
    assert _normalize_location_hints(["F9"]) == []


def test_normalize_none():
    assert _normalize_location_hints(None) == []


def test_normalize_comma_separated_string():
    assert _normalize_location_hints("INV!F9, INV!F10") == ["INV!F9", "INV!F10"]


def test_normalize_dict_item():
    assert _normalize_location_hints([{"sheet": "INV", "cell": "F9"}]) == ["INV!F9"]


def test_validate_result_backfills_from_field_location():
    issue = _validated_issue(field_location="Sheet1!F9")

    assert issue["location_hints"] == ["Sheet1!F9"]
    assert issue["field_location"] == "Sheet1!F9"


def test_validate_result_keeps_human_field_location():
    issue = _validated_issue(location_hints=[], field_location="invoice row 3")

    assert issue["location_hints"] == []
    assert issue["field_location"] == "invoice row 3"


def test_validate_result_tolerates_weird_location_hints():
    issue = _validated_issue(location_hints={"sheet": "INV", "cell": "F9"})

    assert issue["location_hints"] == []


def test_resolver_prefers_location_hints():
    locations, status, code, _ = resolve_issue_locations(
        _issue(location_hints=["Sheet1!F10"], field_location="Sheet1!F9"),
        {
            "file-xlsx": [
                _cell("F9", "HR-EXP250401"),
                _cell("F10", "HR-EXP250401"),
            ]
        },
        _files(),
    )

    assert status == "marked"
    assert code == "MARKED"
    assert [location["cell"] for location in locations] == ["F10"]


def test_resolver_falls_back_when_location_hints_empty():
    locations, status, code, _ = resolve_issue_locations(
        _issue(location_hints=[], field_location="Sheet1!F9"),
        {"file-xlsx": [_cell("F9", "HR-EXP250401")]},
        _files(),
    )

    assert status == "marked"
    assert code == "MARKED"
    assert [location["cell"] for location in locations] == ["F9"]
