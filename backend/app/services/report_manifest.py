"""Build compact machine-readable metadata for report ZIP archives."""

from __future__ import annotations

from pathlib import Path
from typing import Any

_MARK_STATUSES = (
    "marked",
    "not_applicable",
    "unlocated",
    "unsupported_file_type",
    "excel_parse_failed",
    "mark_failed",
    "multiple_candidates",
    "low_confidence",
)


def build_manifest(
    task_id: str,
    identifier: str,
    generated_at: str,
    uploaded_files: list[dict],
    issues: list[dict],
    marked_files: list[dict],
) -> dict:
    """返回 manifest dict，调用方负责 json.dumps"""

    marked_by_file = _marked_files_by_id_or_name(marked_files)
    return {
        "schema_version": "1.0",
        "task_id": task_id,
        "generated_at": generated_at,
        "identifier": identifier,
        "summary": {
            "total_issues": len(issues),
            "by_level": _count_levels(issues),
            "by_mark_status": _count_mark_statuses(issues),
        },
        "files": [_file_entry(item, marked_by_file) for item in uploaded_files],
        "issues": [_issue_entry(issue) for issue in issues],
    }


def _file_entry(file_record: dict[str, Any], marked_by_file: dict[str, dict[str, Any]]) -> dict[str, Any]:
    file_id = str(file_record.get("id") or file_record.get("file_id") or "")
    original_name = _file_name(file_record)
    ext = _file_extension(file_record, original_name)
    marked_result = marked_by_file.get(file_id) or marked_by_file.get(original_name)
    generated = bool(marked_result and marked_result.get("status") == "generated")
    return {
        "file_id": file_id,
        "original_name": original_name,
        "ext": ext,
        "marked_version_generated": generated,
        "marked_version_filename": _marked_filename(marked_result) if generated else None,
        "skip_reason_code": None if generated else _skip_reason(marked_result),
    }


def _issue_entry(issue: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(issue.get("id") or ""),
        "level": str(issue.get("level") or "").upper(),
        "field_name": str(issue.get("field_name") or ""),
        "source_file_name": _source_file_name(issue),
        "locations": [_location_entry(location) for location in _issue_locations(issue)],
        "mark_status": issue.get("mark_status"),
        "mark_reason_code": issue.get("mark_reason_code"),
    }


def _location_entry(location: dict[str, Any]) -> dict[str, Any]:
    return {
        "sheet": str(location.get("sheet") or ""),
        "cell": str(location.get("cell") or ""),
        "confidence": location.get("confidence"),
        "resolver": location.get("resolver"),
    }


def _issue_locations(issue: dict[str, Any]) -> list[dict[str, Any]]:
    locations = issue.get("locations")
    if isinstance(locations, list):
        return [item for item in locations if isinstance(item, dict)]
    return []


def _source_file_name(issue: dict[str, Any]) -> str:
    for location in _issue_locations(issue):
        if location.get("file_name"):
            return str(location["file_name"])
    return str(issue.get("document_label") or issue.get("file_name") or "")


def _count_levels(issues: list[dict[str, Any]]) -> dict[str, int]:
    counts = {"red": 0, "yellow": 0, "blue": 0}
    for issue in issues:
        level = str(issue.get("level") or "").upper().strip()
        if level == "RED":
            counts["red"] += 1
        elif level == "BLUE":
            counts["blue"] += 1
        else:
            counts["yellow"] += 1
    return counts


def _count_mark_statuses(issues: list[dict[str, Any]]) -> dict[str, int]:
    counts = {status: 0 for status in _MARK_STATUSES}
    for issue in issues:
        status = str(issue.get("mark_status") or "").strip()
        if status in counts:
            counts[status] += 1
        elif status:
            counts[status] = counts.get(status, 0) + 1
    return counts


def _marked_files_by_id_or_name(marked_files: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    indexed: dict[str, dict[str, Any]] = {}
    for item in marked_files:
        if not isinstance(item, dict):
            continue
        file_id = str(item.get("file_id") or "")
        if file_id:
            indexed[file_id] = item
        file_name = str(item.get("file_name") or item.get("filename") or item.get("original_name") or "")
        if file_name:
            indexed[file_name] = item
    return indexed


def _marked_filename(marked_result: dict[str, Any] | None) -> str | None:
    if not marked_result:
        return None
    output_path = str(marked_result.get("output_path") or "")
    if output_path:
        return Path(output_path).name
    filename = str(marked_result.get("marked_version_filename") or marked_result.get("filename") or "")
    return filename or None


def _skip_reason(marked_result: dict[str, Any] | None) -> str | None:
    if not marked_result:
        return None
    reason = str(marked_result.get("reason") or "").strip()
    if not reason:
        return None
    if ":" in reason:
        reason = reason.split(":", 1)[0]
    return reason.upper()


def _file_name(file_record: dict[str, Any]) -> str:
    return str(
        file_record.get("filename")
        or file_record.get("original_name")
        or file_record.get("name")
        or file_record.get("file_name")
        or "未命名文件"
    )


def _file_extension(file_record: dict[str, Any], filename: str) -> str:
    extension = str(file_record.get("extension") or file_record.get("ext") or "").strip().lower().lstrip(".")
    if extension:
        return extension
    return Path(filename).suffix.lower().lstrip(".")
