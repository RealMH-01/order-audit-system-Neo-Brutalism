"""Render human-readable audit task metadata for report ZIP archives."""

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


def render_task_info_text(
    task_id: str,
    identifier: str,
    generated_at: str,
    uploaded_files: list[dict],
    issues: list[dict],
    marked_summary: dict,
) -> str:
    """
    返回任务信息文本字符串；
    写入 ZIP 时由调用方使用 text.encode("utf-8-sig")，
    让 Windows 记事本打开不乱码。
    """

    by_level = _count_levels(issues)
    by_status = _count_mark_statuses(issues)
    confidence = _format_confidence(marked_summary.get("confidence"))
    lines: list[str] = [
        "========================================",
        "订单审核报告",
        "========================================",
        "",
        f"任务 ID:        {task_id}",
        f"审核时间:       {generated_at}",
        f"业务标识:       {identifier}",
        "",
        "========================================",
        "本次上传文件清单",
        "========================================",
        "",
    ]

    for index, file_record in enumerate(uploaded_files, start=1):
        lines.append(_render_file_line(index, file_record, marked_summary))

    if not uploaded_files:
        lines.append("（无上传文件记录）")

    lines.extend(
        [
            "",
            "========================================",
            "审核结果摘要",
            "========================================",
            "",
            f"整体置信度:     {confidence}",
            f"共发现问题:     {len(issues)} 个",
            f"  ├─ 红色（高风险）: {by_level['red']}",
            f"  ├─ 黄色（中风险）: {by_level['yellow']}",
            f"  └─ 蓝色（低风险）: {by_level['blue']}",
            "",
            "其中：",
            f"  ├─ 已标记到原表: {by_status['marked']} 个",
            f"  ├─ 建议性/资料类（仅详情版展示）: {by_status['not_applicable']} 个",
            f"  ├─ 未能可靠定位: {by_status['unlocated']} 个",
            f"  └─ 标记版生成失败: {by_status['mark_failed']} 个",
            "",
            "========================================",
            "颜色说明",
            "========================================",
            "",
            "  红色（RED）    - 高风险，需立即处理",
            "  黄色（YELLOW） - 中风险，建议核查",
            "  蓝色（BLUE）   - 低风险，提示参考",
            "",
            "========================================",
            "注意事项",
            "========================================",
            "",
            "1. 标记版是用户上传文件的副本，原文件未被修改。",
            "2. 命中单元格的原背景色可能被审核标记色覆盖（仅在副本中）。",
            "3. 如打开标记版后公式显示异常，请按 F9 让 Excel 重新计算。",
            "4. PDF / Word / 图片可以参与审核，但不生成原文视觉标记，相关问题请查看详情版 Excel 和页面报告。",
            "5. 审核结果仅供参考，请结合人工复核后使用。",
        ]
    )
    return "\n".join(lines)


def _render_file_line(index: int, file_record: dict[str, Any], marked_summary: dict[str, Any]) -> str:
    filename = _file_name(file_record)
    ext = _file_extension(file_record, filename)
    file_type = _file_type_label(ext)
    marker = _file_marker_status(file_record, filename, ext, marked_summary)
    return f"[{index}] {filename:<28} ({file_type}) — {marker}"


def _file_marker_status(file_record: dict[str, Any], filename: str, ext: str, marked_summary: dict[str, Any]) -> str:
    file_id = str(file_record.get("id") or file_record.get("file_id") or "")
    result = _find_file_result(file_id, filename, marked_summary)
    if result and result.get("status") == "generated":
        return "已生成标记版"

    reason = str((result or {}).get("reason") or "")
    if ext == "pdf":
        return "未生成标记版（PDF 暂不支持原文标注）"
    if ext in {"doc", "docx"}:
        return "未生成标记版（Word 暂不支持原文标注）"
    if ext in {"png", "jpg", "jpeg", "bmp", "webp"}:
        return "未生成标记版（图片暂不支持原文标注）"
    if ext in {"xls", "xlsm"}:
        return f"未生成标记版（{ext.upper()} 第一版暂不支持）"
    if result and result.get("status") == "failed":
        return "未生成标记版（生成失败）"
    if reason:
        return f"未生成标记版（{_humanize_reason(reason)}）"
    return "未生成标记版（无可可靠定位的问题）"


def _find_file_result(file_id: str, filename: str, marked_summary: dict[str, Any]) -> dict[str, Any] | None:
    results = marked_summary.get("files") or marked_summary.get("marked_files") or marked_summary.get("file_results")
    if not isinstance(results, list):
        return None
    for item in results:
        if not isinstance(item, dict):
            continue
        if file_id and str(item.get("file_id") or "") == file_id:
            return item
        item_name = str(item.get("file_name") or item.get("filename") or item.get("original_name") or "")
        if item_name and item_name == filename:
            return item
    return None


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


def _format_confidence(value: Any) -> str:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return "未提供"
    if numeric <= 1:
        numeric *= 100
    return f"{numeric:.1f}%"


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


def _file_type_label(ext: str) -> str:
    mapping = {
        "xlsx": "Excel",
        "xls": "Excel",
        "xlsm": "Excel",
        "pdf": "PDF",
        "doc": "Word",
        "docx": "Word",
        "png": "图片",
        "jpg": "图片",
        "jpeg": "图片",
    }
    return mapping.get(ext, ext.upper() if ext else "未知")


def _humanize_reason(reason: str) -> str:
    if reason.startswith("unsupported_file_type:"):
        ext = reason.split(":", 1)[1].upper() or "未知格式"
        return f"{ext} 暂不支持原文标注"
    if reason == "missing_original_xlsx_path":
        return "缺少原始 Excel 文件"
    return reason
