from unittest.mock import MagicMock

from app.services.audit_orchestrator import AuditOrchestratorService


def _make_service():
    return AuditOrchestratorService(
        settings=MagicMock(),
        file_parser=MagicMock(),
        llm_client=MagicMock(),
        report_generator=MagicMock(),
        token_utils=MagicMock(),
        store=MagicMock(),
        repo=None,
    )


def test_extract_basic_english_labels():
    cell_index = [
        {"sheet": "Sheet1", "cell": "B3", "value_str": "ABC-2024-001", "left_label": "Contract No."},
        {"sheet": "Sheet1", "cell": "F9", "value_str": "1.85", "left_label": "Unit Price"},
        {"sheet": "Sheet1", "cell": "F10", "value_str": "1050", "left_label": "Quantity"},
        {"sheet": "Sheet1", "cell": "F11", "value_str": "1942.50", "left_label": "Amount"},
        {"sheet": "Sheet1", "cell": "C5", "value_str": "USD", "left_label": "Currency"},
    ]

    service = _make_service()
    result = service._extract_fields_from_cell_index(cell_index)

    assert "contract_no" in result
    assert result["contract_no"][0]["value"] == "ABC-2024-001"
    assert "unit_price" in result
    assert result["unit_price"][0]["value"] == "1.85"
    assert "quantity" in result
    assert result["quantity"][0]["value"] == "1050"
    assert "amount" in result
    assert result["amount"][0]["value"] == "1942.50"
    assert "currency" in result
    assert result["currency"][0]["value"] == "USD"


def test_extract_chinese_labels():
    cell_index = [
        {"sheet": "Sheet1", "cell": "B3", "value_str": "HT-2024-088", "left_label": "合同编号"},
        {"sheet": "Sheet1", "cell": "D5", "value_str": "3.50", "left_label": "单价"},
        {"sheet": "Sheet1", "cell": "D6", "value_str": "500", "left_label": "数量"},
        {"sheet": "Sheet1", "cell": "E2", "value_str": "卖方公司A", "left_label": "卖方"},
    ]

    service = _make_service()
    result = service._extract_fields_from_cell_index(cell_index)

    assert "contract_no" in result
    assert result["contract_no"][0]["value"] == "HT-2024-088"
    assert "unit_price" in result
    assert result["unit_price"][0]["value"] == "3.50"
    assert "quantity" in result
    assert result["quantity"][0]["value"] == "500"
    assert "seller" in result
    assert result["seller"][0]["value"] == "卖方公司A"


def test_extract_skips_empty_values_and_labels():
    cell_index = [
        {"sheet": "Sheet1", "cell": "B3", "value_str": "", "left_label": "Contract No."},
        {"sheet": "Sheet1", "cell": "B4", "value_str": "   ", "left_label": "Unit Price"},
        {"sheet": "Sheet1", "cell": "B5", "value_str": None, "left_label": "Quantity"},
        {"sheet": "Sheet1", "cell": "B6", "value_str": "1050", "left_label": ""},
        {"sheet": "Sheet1", "cell": "B7", "value_str": "1050", "left_label": None},
    ]

    service = _make_service()
    result = service._extract_fields_from_cell_index(cell_index)

    assert result == {}


def test_format_extracted_fields_output():
    extracted = {
        "contract_no": [
            {"sheet": "Sheet1", "cell": "B3", "label": "Contract No.", "value": "ABC-2024-001"}
        ],
        "unit_price": [
            {"sheet": "Sheet1", "cell": "F9", "label": "Unit Price", "value": "1.85"}
        ],
    }

    service = _make_service()
    text = service._format_extracted_fields("PO基准文件", extracted)

    assert "【系统预提取关键字段：PO基准文件】" in text
    assert "合同号: ABC-2024-001" in text
    assert "Sheet1!B3" in text
    assert "单价: 1.85" in text
    assert "Sheet1!F9" in text


def test_format_extracted_fields_empty_returns_empty_string():
    service = _make_service()

    assert service._format_extracted_fields("PO基准文件", {}) == ""
    assert service._format_extracted_fields("PO基准文件", {"contract_no": []}) == ""
