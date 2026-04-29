"""Resolve model-reported issues to reliable Excel cell locations."""

from __future__ import annotations

import logging
import re
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

from app.services.evidence_locator.cell_index import normalize_merged_cell
from app.services.evidence_locator.field_aliases import match_field, normalize_field_text

logger = logging.getLogger(__name__)

MARK_STATUSES = {
    "marked",
    "not_applicable",
    "unlocated",
    "unsupported_file_type",
    "excel_parse_failed",
    "mark_failed",
    "multiple_candidates",
    "low_confidence",
}

MARK_REASON_CODES = {
    "MARKED",
    "ADVISORY_NO_CELL",
    "NO_BLANK_CELL_LOCATED",
    "NO_CANDIDATE",
    "FILE_TYPE_NOT_EXCEL",
    "PARSE_FAILED",
    "WRITE_FAILED",
    "MULTIPLE_CANDIDATES",
    "LOW_CONFIDENCE",
}

_EMPTY_VALUE_MARKERS = {"", "无", "n/a", "na", "未提供", "未能确认", "none", "null", "-"}
_CURRENCY_AND_UNIT_PATTERN = re.compile(r"(?:USD|EUR|CNY|RMB|GBP|JPY|HKD|US\$|\$|￥|¥|,)", re.IGNORECASE)
_COMMON_PUNCT_PATTERN = re.compile(r"[\s\W_]+", re.UNICODE)

_EXTERNAL_OR_PROCESS_KEYWORDS = (
    "外部资料",
    "补充资料",
    "人工确认",
    "人工复核",
    "流程",
    "合规",
    "资质",
    "备案",
    "许可证",
    "证明文件",
    "缺少文件",
    "缺少资料",
    "未提供资料",
    "建议",
    "review",
    "manual confirmation",
    "supporting document",
    "compliance",
)

_MISSING_KEYWORDS = (
    "缺失",
    "缺少",
    "未填写",
    "未列出",
    "未显示",
    "未提供",
    "为空",
    "missing",
    "not shown",
    "not provided",
    "blank",
)

_DOC_TYPE_ALIASES = {
    "invoice": ("invoice", "commercial invoice", "发票", "商业发票", "ci"),
    "packing_list": ("packing list", "装箱单", "packing", "pl"),
    "po": ("po", "purchase order", "订单", "采购订单"),
    "customs": ("customs", "报关", "报关单"),
    "customs_declaration": ("customs", "报关", "报关单"),
    "contract": ("contract", "合同"),
    "bill_of_lading": ("bill of lading", "提单", "b/l", "bl"),
}


def resolve_issue_locations(
    issue: dict,
    cell_indexes: dict[str, list[dict]],
    uploaded_files: dict,
) -> tuple[list[dict], str, str, str]:
    """
    Return (locations, mark_status, mark_reason_code, mark_reason_text).

    LLM-provided coordinates are treated only as hints. A cell is markable only
    after backend-side anchor verification.
    """

    file_records = _normalize_uploaded_files(uploaded_files)
    file_id = _issue_file_id(issue, cell_indexes)
    file_record = file_records.get(file_id, {}) if file_id else {}

    if _is_advisory_no_cell(issue):
        return [], "not_applicable", "ADVISORY_NO_CELL", "该问题为资料/流程建议，无明确单元格位置"

    if _is_core_missing_without_value(issue):
        return [], "unlocated", "NO_BLANK_CELL_LOCATED", "核心字段缺失，但未可靠定位到空白单元格"

    if not file_id:
        return [], "unlocated", "NO_CANDIDATE", "未找到可用于定位的来源文件"

    if _file_extension(file_record) != "xlsx":
        return [], "unsupported_file_type", "FILE_TYPE_NOT_EXCEL", "来源文件不是可标记 Excel"

    file_index = cell_indexes.get(file_id)
    if not file_index:
        return [], "excel_parse_failed", "PARSE_FAILED", "Excel 单元格索引不存在或解析失败"

    locations, partials = _resolve_from_hints(issue, file_index)
    if locations:
        text = "已定位到 " + "; ".join(_location_ref(item) for item in locations)
        return locations, "marked", "MARKED", text
    if partials and _has_location_hints(issue):
        issue["candidate_locations"] = partials
        return [], "low_confidence", "LOW_CONFIDENCE", "定位置信度不足，未自动标记"

    fallback_locations, fallback_status, fallback_code, fallback_reason = _resolve_by_value_lookup(issue, file_index)
    return fallback_locations, fallback_status, fallback_code, fallback_reason


def values_match(left: Any, right: Any) -> bool:
    """Compare numeric-looking values numerically, otherwise with normalized text similarity."""

    left_text = str(left or "").strip()
    right_text = str(right or "").strip()
    if not left_text or not right_text:
        return False

    left_number = _parse_number(left_text) if _is_numeric_like(left_text) else None
    right_number = _parse_number(right_text) if _is_numeric_like(right_text) else None
    if left_number is not None and right_number is not None:
        return abs(left_number - right_number) <= 1e-9

    normalized_left = _normalize_value_text(left_text)
    normalized_right = _normalize_value_text(right_text)
    if not normalized_left or not normalized_right:
        return False
    if normalized_left == normalized_right:
        return True
    if normalized_left in normalized_right or normalized_right in normalized_left:
        return True
    return SequenceMatcher(None, normalized_left, normalized_right).ratio() >= 0.85


def _resolve_from_hints(issue: dict, file_index: list[dict]) -> tuple[list[dict], list[dict]]:
    by_sheet_cell = {(str(item.get("sheet")), str(item.get("cell")).upper()): item for item in file_index}
    merged_ranges_by_sheet = _merged_ranges_by_sheet(file_index)
    locations: list[dict] = []
    partials: list[dict] = []

    for raw_hint in _location_hints(issue):
        parsed = _parse_location_hint(raw_hint)
        if parsed is None:
            continue
        sheet_name, cell = parsed
        normalized_cell = normalize_merged_cell(sheet_name, cell, merged_ranges_by_sheet.get(sheet_name, []))
        record = by_sheet_cell.get((sheet_name, normalized_cell.upper()))
        if record is None:
            continue

        passed = _anchor_results(issue, record)
        passed_count = sum(1 for value in passed.values() if value)
        if passed_count == 3:
            locations.append(_build_location(record, confidence=0.95, resolver="anchor_verified"))
        elif passed_count == 2:
            partials.append(_build_location(record, confidence=0.75, resolver="partial_match"))

    return _dedupe_locations(locations), _dedupe_locations(partials)


def _resolve_by_value_lookup(issue: dict, file_index: list[dict]) -> tuple[list[dict], str, str, str]:
    candidates: list[dict] = []
    for record in file_index:
        if not any(values_match(record.get("value_str"), value) for value in _candidate_values(issue)):
            continue
        candidates.append(record)

    field_verified = [record for record in candidates if _field_anchor(issue, record)]
    candidate_locations = [
        _build_location(record, confidence=0.0, resolver="candidate")
        for record in field_verified or candidates
    ]

    if len(field_verified) == 1:
        location = _build_location(field_verified[0], confidence=0.85, resolver="value_index_lookup")
        return [location], "marked", "MARKED", f"已定位到 {_location_ref(location)}"
    if len(field_verified) > 1:
        issue["candidate_locations"] = _dedupe_locations(candidate_locations)
        return [], "multiple_candidates", "MULTIPLE_CANDIDATES", "发现多个候选单元格，未自动标记"
    if candidates:
        return [], "unlocated", "NO_CANDIDATE", "候选单元格未通过字段锚点验证"
    return [], "unlocated", "NO_CANDIDATE", "未找到可定位的候选单元格"


def _anchor_results(issue: dict, record: dict) -> dict[str, bool]:
    return {
        "value": _value_anchor(issue, record),
        "field": _field_anchor(issue, record),
        "document": _document_anchor(issue, record),
    }


def _value_anchor(issue: dict, record: dict) -> bool:
    return any(values_match(record.get("value_str"), value) for value in _candidate_values(issue))


def _field_anchor(issue: dict, record: dict) -> bool:
    field_name = str(issue.get("field_name") or "")
    return match_field(record.get("left_label"), field_name) or match_field(record.get("above_header"), field_name)


def _document_anchor(issue: dict, record: dict) -> bool:
    record_type = _normalize_doc_type(record.get("document_type"))
    issue_type = _normalize_doc_type(issue.get("document_type"))
    if record_type and issue_type:
        return record_type == issue_type

    issue_text = _issue_text(issue)
    mentioned_types = _mentioned_doc_types(issue_text)
    if mentioned_types:
        return record_type in mentioned_types
    return bool(record_type)


def _candidate_values(issue: dict) -> list[str]:
    values: list[str] = []
    for key in ("your_value", "observed_value", "source_value", "matched_po_value"):
        value = str(issue.get(key) or "").strip()
        if _is_concrete_value(value) and value not in values:
            values.append(value)
    return values


def _has_concrete_wrong_value(issue: dict) -> bool:
    return any(_is_concrete_value(issue.get(key)) for key in ("your_value", "observed_value", "source_value"))


def _is_concrete_value(value: Any) -> bool:
    text = str(value or "").strip()
    return text.lower() not in _EMPTY_VALUE_MARKERS


def _is_advisory_no_cell(issue: dict) -> bool:
    if _has_concrete_wrong_value(issue):
        return False
    text = _issue_text(issue).lower()
    points_to_process = any(keyword.lower() in text for keyword in _EXTERNAL_OR_PROCESS_KEYWORDS)
    concrete_field = _has_concrete_field(issue)
    return points_to_process and not concrete_field


def _is_core_missing_without_value(issue: dict) -> bool:
    if _has_concrete_wrong_value(issue):
        return False
    text = _issue_text(issue).lower()
    return _has_concrete_field(issue) and any(keyword.lower() in text for keyword in _MISSING_KEYWORDS)


def _has_concrete_field(issue: dict) -> bool:
    field_name = str(issue.get("field_name") or "")
    probes = ["Invoice No.", "Contract No.", "PO No.", "Unit Price", "Quantity", "Total Amount"]
    return any(match_field(probe, field_name) for probe in probes)


def _normalize_uploaded_files(uploaded_files: Any) -> dict[str, dict]:
    if isinstance(uploaded_files, dict):
        if all(isinstance(value, dict) for value in uploaded_files.values()):
            return {str(key): value for key, value in uploaded_files.items()}
        if uploaded_files.get("id"):
            return {str(uploaded_files["id"]): uploaded_files}
    if isinstance(uploaded_files, list):
        return {
            str(item.get("id")): item
            for item in uploaded_files
            if isinstance(item, dict) and item.get("id")
        }
    return {}


def _issue_file_id(issue: dict, cell_indexes: dict[str, list[dict]]) -> str:
    file_id = str(issue.get("file_id") or "").strip()
    if file_id:
        return file_id
    if len(cell_indexes) == 1:
        return next(iter(cell_indexes))
    return ""


def _file_extension(file_record: dict) -> str:
    extension = str(file_record.get("extension") or "").strip().lower().lstrip(".")
    if extension:
        return extension
    filename = str(file_record.get("filename") or "")
    return Path(filename).suffix.lower().lstrip(".")


def _has_location_hints(issue: dict) -> bool:
    return bool(_location_hints(issue))


def _location_hints(issue: dict) -> list[str]:
    hints = issue.get("location_hints")
    if not isinstance(hints, list):
        return []
    return [str(item).strip() for item in hints if str(item).strip()]


def _parse_location_hint(hint: str) -> tuple[str, str] | None:
    text = hint.strip().strip("'\"")
    if "!" not in text:
        return None
    sheet, cell = text.rsplit("!", 1)
    sheet = sheet.strip().strip("'\"")
    cell = cell.strip().upper().replace("$", "")
    if not sheet or not re.match(r"^[A-Z]{1,3}\d{1,7}$", cell):
        return None
    return sheet, cell


def _merged_ranges_by_sheet(file_index: list[dict]) -> dict[str, list[str]]:
    merged: dict[str, list[str]] = {}
    for record in file_index:
        merged_range = record.get("merged_range")
        sheet = str(record.get("sheet") or "")
        if sheet and merged_range:
            ranges = merged.setdefault(sheet, [])
            if str(merged_range) not in ranges:
                ranges.append(str(merged_range))
    return merged


def _build_location(record: dict, *, confidence: float, resolver: str) -> dict:
    return {
        "file_id": record.get("file_id"),
        "file_name": record.get("file_name"),
        "document_type": record.get("document_type"),
        "sheet": record.get("sheet"),
        "cell": record.get("cell"),
        "value_str": record.get("value_str"),
        "confidence": confidence,
        "resolver": resolver,
    }


def _dedupe_locations(locations: list[dict]) -> list[dict]:
    deduped: list[dict] = []
    seen: set[tuple[str, str, str]] = set()
    for location in locations:
        key = (
            str(location.get("file_id") or ""),
            str(location.get("sheet") or ""),
            str(location.get("cell") or ""),
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(location)
    return deduped


def _location_ref(location: dict) -> str:
    return f"{location.get('sheet')}!{location.get('cell')}"


def _normalize_value_text(value: str) -> str:
    return _COMMON_PUNCT_PATTERN.sub("", str(value or "").lower())


def _parse_number(value: str) -> float | None:
    cleaned = _CURRENCY_AND_UNIT_PATTERN.sub("", str(value or "")).strip()
    match = re.search(r"-?\d+(?:\.\d+)?", cleaned)
    if not match:
        return None


def _is_numeric_like(value: str) -> bool:
    cleaned = _CURRENCY_AND_UNIT_PATTERN.sub("", str(value or "")).strip()
    cleaned = re.sub(r"\b(?:KG|KGS|PCS|CTNS|TON|MT)\b", "", cleaned, flags=re.IGNORECASE).strip()
    return bool(re.fullmatch(r"[-+]?\d+(?:\.\d+)?", cleaned))
    try:
        return float(match.group(0))
    except ValueError:
        return None


def _normalize_doc_type(value: Any) -> str:
    raw = normalize_field_text(str(value or ""))
    if not raw:
        return ""
    for doc_type, aliases in _DOC_TYPE_ALIASES.items():
        if raw == normalize_field_text(doc_type):
            return doc_type
        if any(normalize_field_text(alias) in raw or raw in normalize_field_text(alias) for alias in aliases):
            return doc_type
    return raw


def _mentioned_doc_types(text: str) -> set[str]:
    normalized = normalize_field_text(text)
    mentioned: set[str] = set()
    for doc_type, aliases in _DOC_TYPE_ALIASES.items():
        if any(normalize_field_text(alias) in normalized for alias in aliases):
            mentioned.add(doc_type)
    return mentioned


def _issue_text(issue: dict) -> str:
    return " ".join(
        str(issue.get(key, ""))
        for key in (
            "field_name",
            "finding",
            "message",
            "suggestion",
            "source",
            "field_location",
            "document_type",
        )
        if issue.get(key) not in (None, "")
    )
