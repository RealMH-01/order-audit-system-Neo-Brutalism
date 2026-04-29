import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.evidence_locator.resolver import resolve_issue_locations, values_match


def _cell(
    cell,
    value,
    *,
    field="Invoice No.",
    sheet="Sheet1",
    file_id="file-xlsx",
    file_name="CI-test.xlsx",
    document_type="invoice",
    merged_range=None,
):
    return {
        "file_id": file_id,
        "file_name": file_name,
        "document_type": document_type,
        "sheet": sheet,
        "cell": cell,
        "value_str": value,
        "left_label": field,
        "above_header": None,
        "merged_range": merged_range,
    }


def _files(extension="xlsx"):
    return {
        "file-xlsx": {
            "id": "file-xlsx",
            "filename": f"CI-test.{extension}",
            "extension": extension,
        }
    }


def _issue(**overrides):
    issue = {
        "id": "R-01",
        "level": "RED",
        "field_name": "invoice_no",
        "finding": "Invoice value is wrong in invoice.",
        "your_value": "HR-EXP250401",
        "source_value": "HR-EXP250400",
        "document_type": "invoice",
        "file_id": "file-xlsx",
        "location_hints": ["Sheet1!F9"],
    }
    issue.update(overrides)
    return issue


def test_three_anchors_pass_marked_confidence_095():
    locations, status, code, reason = resolve_issue_locations(
        _issue(),
        {"file-xlsx": [_cell("F9", "HR-EXP250401")]},
        _files(),
    )

    assert status == "marked"
    assert code == "MARKED"
    assert "Sheet1!F9" in reason
    assert locations[0]["cell"] == "F9"
    assert locations[0]["confidence"] == 0.95
    assert locations[0]["resolver"] == "anchor_verified"


def test_field_anchor_failure_discards_hint():
    locations, status, code, _ = resolve_issue_locations(
        _issue(),
        {"file-xlsx": [_cell("F9", "HR-EXP250401", field="Contract No.")]},
        _files(),
    )

    assert locations == []
    assert status == "low_confidence"
    assert code == "LOW_CONFIDENCE"


def test_document_anchor_failure_discards_hint():
    locations, status, code, _ = resolve_issue_locations(
        _issue(document_type="packing_list"),
        {"file-xlsx": [_cell("F9", "HR-EXP250401", document_type="invoice")]},
        _files(),
    )

    assert locations == []
    assert status == "low_confidence"
    assert code == "LOW_CONFIDENCE"


def test_advisory_external_material_issue_is_not_applicable():
    locations, status, code, reason = resolve_issue_locations(
        _issue(
            field_name="supporting_documents",
            finding="Need supporting document and manual confirmation.",
            your_value="",
            source_value="",
            location_hints=[],
        ),
        {"file-xlsx": [_cell("F9", "HR-EXP250401")]},
        _files(),
    )

    assert locations == []
    assert status == "not_applicable"
    assert code == "ADVISORY_NO_CELL"
    assert "资料" in reason


def test_core_field_missing_without_blank_cell_is_unlocated():
    locations, status, code, _ = resolve_issue_locations(
        _issue(
            field_name="invoice_no",
            finding="Invoice No. is missing.",
            your_value="",
            source_value="",
            location_hints=[],
        ),
        {"file-xlsx": [_cell("A1", "Some other value")]},
        _files(),
    )

    assert locations == []
    assert status == "unlocated"
    assert code == "NO_BLANK_CELL_LOCATED"


def test_pdf_source_is_unsupported():
    locations, status, code, _ = resolve_issue_locations(
        _issue(),
        {"file-xlsx": [_cell("F9", "HR-EXP250401")]},
        _files("pdf"),
    )

    assert locations == []
    assert status == "unsupported_file_type"
    assert code == "FILE_TYPE_NOT_EXCEL"


def test_no_hint_unique_value_hit_with_field_anchor_is_marked():
    locations, status, code, _ = resolve_issue_locations(
        _issue(location_hints=[]),
        {"file-xlsx": [_cell("F9", "HR-EXP250401")]},
        _files(),
    )

    assert status == "marked"
    assert code == "MARKED"
    assert locations[0]["cell"] == "F9"
    assert locations[0]["confidence"] == 0.85
    assert locations[0]["resolver"] == "value_index_lookup"


def test_no_hint_multiple_candidates_are_not_marked():
    issue = _issue(location_hints=[])

    locations, status, code, _ = resolve_issue_locations(
        issue,
        {
            "file-xlsx": [
                _cell("F9", "HR-EXP250401"),
                _cell("F23", "HR-EXP250401"),
            ]
        },
        _files(),
    )

    assert locations == []
    assert status == "multiple_candidates"
    assert code == "MULTIPLE_CANDIDATES"
    assert [item["cell"] for item in issue["candidate_locations"]] == ["F9", "F23"]


def test_partial_match_only_returns_low_confidence_without_locations():
    issue = _issue(field_name="invoice_no")

    locations, status, code, _ = resolve_issue_locations(
        issue,
        {"file-xlsx": [_cell("F9", "HR-EXP250401", field="Invoice No.", document_type="packing_list")]},
        _files(),
    )

    assert locations == []
    assert status == "low_confidence"
    assert code == "LOW_CONFIDENCE"
    assert issue["candidate_locations"][0]["confidence"] == 0.75
    assert issue["candidate_locations"][0]["resolver"] == "partial_match"


def test_difflib_similarity_matches_normalized_strings():
    assert values_match("HR-EXP250401", "HR EXP250401")
    assert values_match("USD 1,050.00", "1050")
    assert values_match("Invoice Numbr", "Invoice Number")


def test_merged_child_hint_normalizes_to_anchor():
    locations, status, code, _ = resolve_issue_locations(
        _issue(location_hints=["Sheet1!B2"]),
        {"file-xlsx": [_cell("A1", "HR-EXP250401", merged_range="A1:B2")]},
        _files(),
    )

    assert status == "marked"
    assert code == "MARKED"
    assert locations[0]["cell"] == "A1"
