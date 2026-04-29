"""Helpers for user-facing report filenames."""

from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import Any

_WINDOWS_ILLEGAL_CHARS = re.compile(r'[<>:"/\\|?*]')
_CONTROL_WHITESPACE = re.compile(r"[\n\r\t]")
_MULTIPLE_UNDERSCORES = re.compile(r"_+")


def build_report_filename(kind: str, identifier: str, ext: str = "xlsx") -> str:
    """
    kind: '标记版' | '详情版' | '报告'
    identifier: 业务标识
    ext: 扩展名，不带点
    返回："审核{kind}-{清洗后identifier}-{YYYYMMDD-HHmm}.{ext}"
    """

    cleaned_identifier = _sanitize_identifier(identifier)
    cleaned_ext = str(ext or "xlsx").strip().lstrip(".") or "xlsx"
    timestamp = datetime.now().strftime("%Y%m%d-%H%M")
    return f"审核{kind}-{cleaned_identifier}-{timestamp}.{cleaned_ext}"


def pick_report_identifier(audit_context: Any, task_id: str) -> str:
    """
    优先级：
    基准单据订单号 > 基准单据 PO 号 > 基准单据合同号
    > 第一个上传文件的安全短名 > task_id 前 8 位

    TODO: 基准单据识别逻辑待业务规则细化。
    """

    baseline = _read_first_mapping(
        audit_context,
        (
            "baseline_document",
            "baseline_doc",
            "base_document",
            "po_record",
            "po_document",
        ),
    )
    for key in (
        "order_no",
        "order_number",
        "order_id",
        "po_no",
        "po_number",
        "purchase_order_no",
        "contract_no",
        "contract_number",
    ):
        value = _read_value(baseline, key)
        if str(value or "").strip():
            return str(value)

    filename = _first_uploaded_filename(audit_context, baseline)
    if filename:
        stem = Path(filename).stem
        safe_stem = _sanitize_identifier(stem)
        if safe_stem != "未知":
            return safe_stem

    return str(task_id or "")[:8]


def _sanitize_identifier(identifier: str) -> str:
    text = _WINDOWS_ILLEGAL_CHARS.sub("_", str(identifier or ""))
    text = _CONTROL_WHITESPACE.sub("", text)
    text = text.strip(" .")
    text = _MULTIPLE_UNDERSCORES.sub("_", text)
    text = text[:40]
    return text or "未知"


def _read_value(source: Any, key: str) -> Any:
    if isinstance(source, dict):
        return source.get(key)
    return getattr(source, key, None)


def _read_first_mapping(source: Any, keys: tuple[str, ...]) -> Any:
    for key in keys:
        value = _read_value(source, key)
        if value is not None:
            return value
    return {}


def _first_uploaded_filename(audit_context: Any, baseline: Any) -> str:
    baseline_filename = _read_value(baseline, "filename")
    if str(baseline_filename or "").strip():
        return str(baseline_filename)

    for key in ("uploaded_files", "files", "file_records"):
        files = _read_value(audit_context, key)
        if not isinstance(files, list):
            continue
        for item in files:
            filename = _read_value(item, "filename")
            if str(filename or "").strip():
                return str(filename)
    return ""
