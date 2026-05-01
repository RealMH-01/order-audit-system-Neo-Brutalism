"""审核任务调度器：连接文件解析、Prompt 构造、模型调用、结果修正和报告输出。"""

from __future__ import annotations

import asyncio
import copy
import io
import json
import logging
import os
import re
import shutil
import tempfile
import zipfile
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Awaitable, Callable
from uuid import uuid4

from app.config import Settings
from app.db.repository import SupabaseRepository
from app.db.supabase_client import ApiKeyCipher, EncryptionConfigurationError
from app.errors import AppError
from app.models.schemas import (
    AuditCapability,
    AuditCancelResponse,
    AuditHistoryDetailResponse,
    AuditHistoryItem,
    AuditHistoryListResponse,
    AuditIssue,
    AuditProgressPayload,
    AuditReportResponse,
    AuditResultResponse,
    AuditStartRequest,
    AuditStartResponse,
    CurrentUser,
    FeatureStatus,
)
from app.services.audit_engine import AuditEngineService, SYSTEM_PROMPT_TEXT
from app.services.evidence_locator import build_cell_index, resolve_issue_locations
from app.services.file_parser import FileParserService
from app.services.llm_client import LLMClientService, format_cell_index_for_llm
from app.services.report_filename import build_report_filename, pick_report_identifier
from app.services.report_generator import ReportGeneratorService
from app.services.runtime_store import RuntimeStore
from app.services.template_library import TemplateLibraryService
from app.services.token_utils import TokenUtilityService

logger = logging.getLogger(__name__)

_USER_FACING_AUDIT_SYSTEM_ERROR_MESSAGE = "审核过程中出现系统异常，请稍后重试。如果问题持续，请联系管理员。"
_TECHNICAL_TASK_MESSAGE_PATTERN = re.compile(
    r"supabase|postgrest|postgresql|postgres|database|relation|traceback|keyerror|stack|sql|"
    r"syntax error|typeerror|referenceerror|validationerror|validation error|pydantic|pgrst|"
    r"python|exception|column|table|schema|fastapi|raw response|internal server error|"
    r"response body|doctype|<html",
    re.IGNORECASE,
)

_DOC_TYPE_HINTS = {
    "invoice": {"invoice", "commercial_invoice", "inv"},
    "packing_list": {"packing_list", "packing", "plist"},
    "shipping_instruction": {"shipping_instruction", "shipping", "si"},
    "bill_of_lading": {"bill_of_lading", "bol", "b_l", "b-l"},
    "certificate_of_origin": {"certificate_of_origin", "coo", "c_o"},
    "customs_declaration": {"customs_declaration", "customs", "declaration"},
    "letter_of_credit": {"letter_of_credit", "lc", "l_c"},
    "po": {"po", "purchase_order"},
}

_EXTENSION_FALLBACKS = {"pdf", "xlsx", "xlsm", "xls", "docx", "png", "jpg", "jpeg", "txt", "csv", "other"}

_DIAG_KEYWORDS = (
    "1.85",
    "1.83",
    "unit price",
    "Unit Price",
    "单价",
    "1,050",
    "1050",
    "20 IBC",
    "38,850",
    "38850",
    "21,000",
    "21000",
    "Contract No",
    "Invoice No",
    "PO No",
)

_EVIDENCE_FIELD_LABELS = {
    "contract_no": ("Contract No.", "contract no", "contract number", "合同号", "合同编号"),
    "invoice_no": ("Invoice No.", "invoice no", "invoice number", "发票号", "发票号码"),
    "po_no": ("PO No.", "po no", "po number", "purchase order no", "采购订单号", "订单号"),
    "unit_price": ("Unit Price", "unit price", "单价"),
    "quantity": ("Quantity", "quantity", "Qty", "qty", "数量"),
    "packing": ("Packing", "packing", "包装"),
    "amount": ("Amount", "amount", "Total Value", "total value", "Total", "total", "总金额", "金额"),
    "currency": ("Currency", "currency", "币种", "币别", "CCY", "ccy"),
    "buyer": ("Buyer", "buyer", "买方", "购买方", "Applicant", "applicant", "进口商", "Importer", "importer"),
    "seller": (
        "Seller",
        "seller",
        "卖方",
        "供应商",
        "Supplier",
        "supplier",
        "Beneficiary",
        "beneficiary",
        "出口商",
        "Exporter",
        "exporter",
    ),
    "incoterm": ("Incoterm", "incoterm", "贸易术语", "Trade Term", "trade term", "价格条件"),
}

_DOWNGRADE_ALLOWED_FIELDS = {
    "seller",
    "supplier",
    "shipper",
    "exporter",
    "notify_party",
    "beneficiary",
}

_DOWNGRADE_BLOCKED_KEYWORDS = {"buyer", "consignee", "importer", "收货人", "买方"}

_PROVIDER_PROFILE_KEY_FIELDS = {
    "openai": "openai_api_key",
    "deepseek": "deepseek_api_key",
    "zhipuai": "zhipu_api_key",
}

_CORE_IDENTIFIER_SPECS = (
    {
        "field_name": "合同号",
        "issue_key": "contract-number",
        "patterns": (
            r"(?:合同号|合同编号|合同号码)\s*[:：#-]?\s*([A-Z0-9][A-Z0-9._/\-]{3,})",
            r"(?:contract\s*(?:no\.?|number|#)?)\s*[:：#-]?\s*([A-Z0-9][A-Z0-9._/\-]{3,})",
        ),
    },
    {
        "field_name": "订单号/PO号",
        "issue_key": "order-number",
        "patterns": (
            r"(?:订单号|订单编号|采购订单号|PO\s*(?:NO\.?|NUMBER|#)?)\s*[:：#-]?\s*([A-Z0-9][A-Z0-9._/\-]{3,})",
            r"(?:order\s*(?:no\.?|number|#)?)\s*[:：#-]?\s*([A-Z0-9][A-Z0-9._/\-]{3,})",
        ),
    },
    {
        "field_name": "发票号",
        "issue_key": "invoice-number",
        "patterns": (
            r"(?:发票号|发票号码|invoice\s*(?:no\.?|number|#)?)\s*[:：#-]?\s*([A-Z0-9][A-Z0-9._/\-]{3,})",
        ),
    },
    {
        "field_name": "提单号",
        "issue_key": "bill-of-lading-number",
        "patterns": (
            r"(?:提单号|提单编号|B/L\s*(?:NO\.?|#)?|BL\s*(?:NO\.?|#)?|bill\s+of\s+lading\s*(?:no\.?|number|#)?)\s*[:：#-]?\s*([A-Z0-9][A-Z0-9._/\-]{3,})",
        ),
    },
)


_REPORT_DOWNLOADS = {
    "marked": {
        "bundle_key": "marked_report",
        "kind": "标记版",
        "ext": "zip",
        "media_type": "application/zip",
    },
    "detailed": {
        "bundle_key": "detailed_report",
        "kind": "详情版",
        "ext": "xlsx",
        "media_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    "zip": {
        "bundle_key": "report_zip",
        "kind": "报告",
        "ext": "zip",
        "media_type": "application/zip",
    },
}

_AUDIT_REPORT_BUCKET = "audit-reports"
_REPORT_STORAGE_FILENAMES = {
    "marked": "marked.zip",
    "detailed": "detailed.xlsx",
    "zip": "reports.zip",
}

_MARKED_DOWNLOAD_MESSAGES = {
    "NO_MARKABLE_XLSX": "本次任务没有可生成原表标记副本的 Excel 文件。",
    "ONLY_UNSUPPORTED_FILES": "本次上传文件暂不支持生成原表标记副本。",
    "NO_MARKED_WORKBOOK": "本次审核没有成功生成可下载的原表标记副本。",
    "LEGACY_TASK_NO_MARKED_WORKBOOK": "该历史任务未保留可下载的原表标记副本，请重新运行审核后下载。",
    "MARKED_REPORT_UNAVAILABLE": "标记版报告暂不可用，请重新运行审核后下载。",
}


def _safe_user_facing_task_message(message: str) -> str:
    text = str(message or "").strip()
    if not text:
        return _USER_FACING_AUDIT_SYSTEM_ERROR_MESSAGE
    if text == "[object Object]" or _TECHNICAL_TASK_MESSAGE_PATTERN.search(text):
        return _USER_FACING_AUDIT_SYSTEM_ERROR_MESSAGE
    if (text.startswith("{") and text.endswith("}")) or (text.startswith("[") and text.endswith("]")):
        return _USER_FACING_AUDIT_SYSTEM_ERROR_MESSAGE
    return text


class AuditOrchestratorService:
    """协调审核执行流水线。"""

    # RuntimeStore 会持有文件内容、上下文和报告对象，必须限制并发审核数，避免极端情况下撑爆内存。
    MAX_CONCURRENT_AUDITS = 5
    # 单次 LLM 调用超时由 orchestrator 统一传入，便于后续按任务类型调整。
    _LLM_SINGLE_CALL_TIMEOUT_SECONDS = 120.0

    def __init__(
        self,
        settings: Settings,
        file_parser: FileParserService,
        llm_client: LLMClientService,
        report_generator: ReportGeneratorService,
        token_utils: TokenUtilityService,
        store: RuntimeStore,
        repo: SupabaseRepository | None = None,
    ) -> None:
        self.settings = settings
        self.file_parser = file_parser
        self.llm_client = llm_client
        self.report_generator = report_generator
        self.token_utils = token_utils
        self.store = store
        self.repo = repo
        self.cipher = ApiKeyCipher(settings)
        self.audit_engine = AuditEngineService()
        self.template_library = TemplateLibraryService(store=store, repo=repo)
        # 允许 Settings 覆盖默认并发上限，同时至少保留 1 个审核槽位，避免配置错误导致服务不可用。
        self.max_concurrent_audits = max(1, int(settings.max_concurrent_audits or self.MAX_CONCURRENT_AUDITS))

    def get_capability(self) -> AuditCapability:
        """返回执行层能力说明。"""

        return AuditCapability(
            mode="execution-pipeline",
            features=[
                FeatureStatus(
                    name="审核任务执行主干",
                    ready=True,
                    note="已接通文件解析、Prompt 构造、模型调用、结果修正和报告输出主链路。",
                ),
                FeatureStatus(
                    name="并行审核",
                    ready=True,
                    note="第一轮 target 文件审核已支持 asyncio.gather 并行结构。",
                ),
                *self.audit_engine.get_features(),
                *self.report_generator.get_features(),
                *self.token_utils.get_features(),
                *self.llm_client.get_provider_features(),
            ],
        )

    def _cleanup_stale_tasks(self) -> None:
        """清理已结束任务中不再需要的内存对象。"""

        now = datetime.now(timezone.utc)
        clear_after = timedelta(minutes=30)
        delete_after = timedelta(hours=2)
        removable_statuses = {"completed", "failed", "cancelled"}
        task_ids_to_delete: list[str] = []

        for task_id, task in list(self.store.audit_tasks.items()):
            if task.get("status") not in removable_statuses:
                continue

            updated_at = task.get("updated_at")
            if not isinstance(updated_at, datetime):
                continue
            if updated_at.tzinfo is None:
                updated_at = updated_at.replace(tzinfo=timezone.utc)

            age = now - updated_at
            if age > clear_after:
                task["full_result"] = None
                task["report_bundle"] = None
                task["result"] = None
            if age > delete_after:
                task_ids_to_delete.append(task_id)

        for task_id in task_ids_to_delete:
            self.store.audit_tasks.pop(task_id, None)

    def start_audit(
        self,
        current_user: CurrentUser,
        payload: AuditStartRequest,
    ) -> AuditStartResponse:
        """创建审核任务并启动后台协程。"""

        self._cleanup_stale_tasks()
        running_task_count = sum(
            1
            for task in self.store.audit_tasks.values()
            if task.get("status") in {"queued", "running"}
        )
        # 在创建新任务前做并发闸门，避免 RuntimeStore 同时堆积过多文件内容、上下文和报告对象。
        if running_task_count >= self.max_concurrent_audits:
            raise AppError("当前系统审核任务已满，请稍后再试。", status_code=429)

        self.file_parser.get_user_file(current_user.id, payload.po_file_id)
        for item in payload.target_files:
            self.file_parser.get_user_file(current_user.id, item.file_id)
        for item in payload.prev_ticket_files:
            self.file_parser.get_user_file(current_user.id, item.file_id)
        if payload.template_file_id:
            self.file_parser.get_user_file(current_user.id, payload.template_file_id)
        for file_id in payload.reference_file_ids:
            self.file_parser.get_user_file(current_user.id, file_id)

        profile = self._get_profile(current_user.id)
        selected_model = str(profile.get("selected_model") or self.settings.default_text_model)
        primary_provider = self.llm_client._resolve_provider(None, selected_model)
        self._require_profile_api_key(profile, primary_provider)
        company_affiliates = list(profile.get("company_affiliates", []))
        resolved_rules = self.template_library.resolve_audit_rules_for_run(
            current_user=current_user,
            template_id=payload.template_id,
            temporary_rules=[],
        )

        task_id = str(uuid4())
        now = datetime.now(timezone.utc)
        self.store.audit_tasks[task_id] = {
            "task_id": task_id,
            "user_id": current_user.id,
            "status": "queued",
            "progress_percent": 0,
            "message": "审核任务已创建，等待处理。",
            "po_file_id": payload.po_file_id,
            "target_files": [item.model_dump() for item in payload.target_files],
            "prev_ticket_files": [item.model_dump() for item in payload.prev_ticket_files],
            "template_file_id": payload.template_file_id,
            "template_id": resolved_rules.template.id if resolved_rules.template else None,
            "reference_file_ids": list(payload.reference_file_ids),
            "custom_rules": [],
            "company_affiliates": company_affiliates,
            "audit_rules_text": resolved_rules.rules_text,
            "audit_rule_snapshot": resolved_rules.rule_snapshot,
            "deep_think": payload.deep_think,
            "cancel_requested": False,
            "created_at": now,
            "updated_at": now,
            "result": None,
            "full_result": None,
            "report_bundle": None,
            "report_paths": None,
            "audit_temp_dir": None,
            "original_xlsx_paths": {},
            "cell_indexes": {},
            "llm_raw_issues": [],
        }
        self.store.audit_tasks[task_id]["_async_task"] = asyncio.create_task(self._run_task(task_id))
        return AuditStartResponse(task_id=task_id, status="queued", message="审核任务已创建，等待处理。")

    async def run_full_audit(
        self,
        *,
        user_id: str,
        task_id: str,
        progress_callback: Callable[[int, str], Awaitable[None] | None] | None = None,
        should_cancel: Callable[[], bool] | None = None,
    ) -> dict[str, Any]:
        """执行完整审核主干：解析 -> 第一轮审核 -> 自定义规则 -> 交叉比对 -> 报告。"""

        task = self._get_task(user_id, task_id)
        profile = self._get_profile(user_id)
        company_affiliates = list(profile.get("company_affiliates", []))
        selected_model = str(profile.get("selected_model") or self.settings.default_text_model)
        primary_provider = self.llm_client._resolve_provider(None, selected_model)
        audit_rules_text = str(task.get("audit_rules_text") or "")

        await self._notify_progress(progress_callback, 5, "正在准备审核上下文。")
        self._ensure_not_cancelled(should_cancel)

        po_record = self._ensure_runtime_file(task["po_file_id"])
        prev_records = [self._ensure_runtime_file(item["file_id"]) for item in task["prev_ticket_files"]]
        template_record = self._ensure_runtime_file(task["template_file_id"]) if task.get("template_file_id") else None
        reference_records = [self._ensure_runtime_file(file_id) for file_id in task["reference_file_ids"]]

        targets = list(task["target_files"])
        target_records_by_id = {
            str(item["file_id"]): self._ensure_runtime_file(item["file_id"])
            for item in targets
            if isinstance(item, dict) and item.get("file_id")
        }
        self._prepare_xlsx_task_context(
            task,
            [
                po_record,
                *target_records_by_id.values(),
                *prev_records,
                *([template_record] if template_record else []),
                *reference_records,
            ],
        )
        completed = 0
        progress_lock = asyncio.Lock()

        async def _update_target_progress(doc_type: str) -> None:
            nonlocal completed
            async with progress_lock:
                completed += 1
                percent = 15 + int((completed / max(len(targets), 1)) * 55)
                await self._notify_progress(progress_callback, percent, f"已完成 {completed}/{len(targets)} 份单据审核：{doc_type}")

        async def _audit_target(index: int, target_item: dict[str, Any]) -> dict[str, Any]:
            result = await self._run_single_target_audit(
                user_id=user_id,
                index=index,
                target_item=target_item,
                task=task,
                po_record=po_record,
                prev_records=prev_records,
                template_record=template_record,
                reference_records=reference_records,
                selected_model=selected_model,
                primary_provider=primary_provider,
                target_count=len(targets),
                deep_think=bool(task["deep_think"]),
                custom_rules=list(task["custom_rules"]),
                audit_rules_text=audit_rules_text,
                company_affiliates=company_affiliates,
                should_cancel=should_cancel,
                progress_callback=progress_callback,
            )
            await _update_target_progress(result["doc_type"])
            return result

        first_round_results = await asyncio.gather(*[_audit_target(index, item) for index, item in enumerate(targets)])
        self._ensure_not_cancelled(should_cancel)

        # --- 多目标文件交叉一致性检查 ---
        successful_target_texts = []
        for item in first_round_results:
            if not isinstance(item, dict):
                continue
            result = item.get("result")
            if not isinstance(result, dict):
                continue
            doc_type = item.get("doc_type", "unknown")
            target_text = str(result.get("target_text", ""))
            if not target_text.strip():
                file_id = item.get("file_id")
                if not file_id:
                    continue
                target_record = self._ensure_runtime_file(str(file_id))
                target_text = str(target_record.get("text", ""))
            if target_text.strip():
                successful_target_texts.append(
                    {
                        "type": str(doc_type),
                        "content": target_text,
                    }
                )

        cross_check_result = None
        if len(successful_target_texts) >= 2:
            await self._notify_progress(progress_callback, 75, "正在进行多目标文件交叉一致性检查。")
            self._ensure_not_cancelled(should_cancel)
            try:
                cross_check_result = await self._run_cross_file_check(
                    successful_target_texts=successful_target_texts,
                    user_id=user_id,
                    task=task,
                    selected_model=selected_model,
                    primary_provider=primary_provider,
                    should_cancel=should_cancel,
                )
            except Exception:
                logger.warning("Multi-target cross-file check failed, skipping.", exc_info=True)
                cross_check_result = None

        await self._notify_progress(progress_callback, 80, "正在汇总审核结果并生成报告。")
        aggregate_result = self._aggregate_results(first_round_results)
        aggregate_result["llm_raw_issues"] = copy.deepcopy(task.get("llm_raw_issues") or [])

        # 把交叉检查结果追加到 aggregate_result 中（不修改单文件结果）
        if cross_check_result and isinstance(cross_check_result.get("issues"), list):
            cross_issues = cross_check_result["issues"]
            # 给交叉检查 issues 加 X- 前缀编号
            for idx, issue in enumerate(cross_issues, 1):
                if isinstance(issue, dict):
                    issue["id"] = f"X-{idx:02d}"
                    issue["locations"] = []
                    issue["mark_status"] = "not_applicable"
                    issue["mark_reason_code"] = "ADVISORY_NO_CELL"
                    issue["mark_reason"] = "跨文件问题不对应单一原 Excel 单元格"
                    issue["source"] = "多目标文件交叉检查"
                    issue["field_location"] = "多目标文件交叉检查"
                    issue["document_label"] = "多目标文件交叉检查"
            # 追加到 aggregate_result 的 issues 列表
            agg_issues = aggregate_result.get("issues")
            if isinstance(agg_issues, list):
                agg_issues.extend(cross_issues)
            else:
                aggregate_result["issues"] = list(cross_issues)
            # 重新计数 summary
            aggregate_result["summary"] = self._recount_summary(
                [i for i in aggregate_result.get("issues", []) if isinstance(i, dict)]
            )

        uploaded_target_records = [
            target_records_by_id.get(str(item["file_id"])) or self._ensure_runtime_file(item["file_id"])
            for item in targets
            if isinstance(item, dict) and item.get("file_id")
        ]
        original_xlsx_paths = {
            str(file_id): str(path)
            for file_id, path in dict(task.get("original_xlsx_paths") or {}).items()
            if path and Path(str(path)).exists()
        }
        logger.info(
            "AUDIT_XLSX_AVAILABLE_FOR_REPORT task_id=%s original_xlsx_count=%d paths=%s",
            task_id,
            len(original_xlsx_paths),
            original_xlsx_paths,
        )
        report_context = {
            "baseline_document": po_record,
            "uploaded_files": [po_record, *uploaded_target_records],
            "original_xlsx_paths": original_xlsx_paths,
            "cell_indexes": dict(task.get("cell_indexes") or {}),
        }
        report_bundle = self.report_generator.generate_report_bundle(task_id, aggregate_result, report_context)
        logger.info(
            "AUDIT_XLSX_REPORT_GENERATED task_id=%s original_xlsx_count=%d",
            task_id,
            len(original_xlsx_paths),
        )

        return {
            "aggregate_result": aggregate_result,
            "document_results": first_round_results,
            "cross_check_result": cross_check_result,
            "report_bundle": report_bundle,
            "provider": primary_provider,
        }

    async def _run_cross_file_check(
        self,
        *,
        successful_target_texts: list[dict[str, str]],
        user_id: str,
        task: dict[str, Any],
        selected_model: str,
        primary_provider: str,
        should_cancel: Callable[[], bool] | None,
    ) -> dict[str, Any] | None:
        """对多个目标文件执行交叉一致性检查。

        只关注多个目标文件之间的字段一致性，不重复单文件审核已发现的问题。
        """
        profile = self._get_profile(user_id)
        user_api_key = self._require_profile_api_key(profile, primary_provider)

        # 构造交叉检查 prompt
        parts: list[str] = []
        parts.append("【多目标文件交叉一致性检查】")
        parts.append(
            "请检查以下多份目标单据之间，相同字段的数据是否一致。"
            "只关注跨文件不一致的问题，不要重复报告单文件内部已有的问题。"
        )
        for i, target in enumerate(successful_target_texts, 1):
            doc_type = target.get("type", f"单据{i}")
            content = target.get("content", "")
            parts.append(f"\n【目标单据{i}：{doc_type}】\n{content}")
        parts.append("""
【交叉检查重点】
1. 金额、数量、单价、币种是否在多份单据之间一致
2. 品名、规格、型号是否一致
3. 箱数、毛重、净重、体积是否一致
4. 合同号、订单号、发票号、提单号等编号引用是否一致
5. 收发货人、目的港、运输信息等关键字段是否一致

【严重程度】
- RED：明确的跨文件数据矛盾
- YELLOW：可能的不一致，需人工确认

【输出格式——严格按以下JSON格式输出，不要有任何其他文字】
{
  "summary": {"red": 0, "yellow": 0, "blue": 0, "total": 0},
  "issues": [
    {
      "id": "X-01",
      "level": "RED",
      "field_name": "字段中文名称",
      "field_location": "涉及的单据名称",
      "your_value": "单据A上的值",
      "source_value": "单据B上的值",
      "source": "多目标文件交叉检查",
      "suggestion": "中文建议",
      "confidence": 0.0
    }
  ]
}
如果所有单据之间数据完全一致，返回 issues 为空列表。""")

        user_content = "\n".join(parts)
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT_TEXT},
            {"role": "user", "content": user_content},
        ]

        self._ensure_not_cancelled(should_cancel)
        raw_response = await self._await_llm_call(
            lambda: self.llm_client.call_llm(
                messages,
                provider=primary_provider,
                requested_model=selected_model,
                api_key=user_api_key,
                deep_think=False,
                timeout=self._LLM_SINGLE_CALL_TIMEOUT_SECONDS,
            ),
            should_cancel=should_cancel,
        )

        parsed = self.audit_engine.parse_audit_result(raw_response)
        return parsed

    def get_progress_snapshot(self, current_user: CurrentUser, task_id: str) -> AuditProgressPayload:
        """返回当前任务进度快照。"""

        task = self._get_task(current_user.id, task_id)
        return AuditProgressPayload(
            task_id=task_id,
            status=str(task["status"]),
            progress_percent=int(task["progress_percent"]),
            message=str(task["message"]),
            created_at=task["created_at"],
            updated_at=task["updated_at"],
        )

    async def progress_stream(self, current_user: CurrentUser, task_id: str):
        """以 SSE 输出任务进度。"""

        while True:
            payload = self.get_progress_snapshot(current_user, task_id)
            yield f"data: {json.dumps(payload.model_dump(mode='json'), ensure_ascii=False)}\n\n"
            if payload.status in {"completed", "cancelled", "failed"}:
                break
            await asyncio.sleep(0.5)

    def cancel_task(self, current_user: CurrentUser, task_id: str) -> AuditCancelResponse:
        """取消任务。"""

        task = self._get_task(current_user.id, task_id)
        if task["status"] in {"completed", "cancelled", "failed"}:
            return AuditCancelResponse(task_id=task_id, status=str(task["status"]), message="该任务已经结束，无需重复取消。")

        task["cancel_requested"] = True
        task["status"] = "cancelling"
        task["message"] = "已收到取消请求，正在停止任务。"
        task["updated_at"] = datetime.now(timezone.utc)
        async_task = task.get("_async_task")
        if isinstance(async_task, asyncio.Task) and not async_task.done():
            async_task.cancel()
        return AuditCancelResponse(task_id=task_id, status="cancelling", message="已收到取消请求，正在停止任务。")

    def get_result(self, current_user: CurrentUser, task_id: str) -> AuditResultResponse:
        """读取当前任务结果。"""

        task = self._get_task(current_user.id, task_id)
        if task["result"] is None:
            rule_snapshot = self._result_rule_snapshot_from_task(task)
            return AuditResultResponse(
                task_id=task_id,
                status=str(task["status"]),
                summary={"red": 0, "yellow": 0, "blue": 0},
                issues=[],
                rule_snapshot=rule_snapshot,
                message="任务尚未产出最终结果。",
            )
        result = task["result"]
        rule_snapshot = self._result_rule_snapshot_from_task(task)
        if isinstance(result, AuditResultResponse):
            if result.rule_snapshot is None and rule_snapshot is not None:
                return result.model_copy(update={"rule_snapshot": rule_snapshot})
            return result
        if isinstance(result, dict):
            result_payload = {**result, "rule_snapshot": result.get("rule_snapshot") or rule_snapshot}
            return AuditResultResponse(**result_payload)
        return result

    def get_report_placeholder(self, current_user: CurrentUser, task_id: str) -> AuditReportResponse:
        """返回报告状态说明。"""

        try:
            task = self._get_task(current_user.id, task_id)
        except AppError as exc:
            if exc.status_code != 404 or not self._has_persisted_report_bundle(current_user.id, task_id):
                raise
            return AuditReportResponse(
                task_id=task_id,
                message="报告已生成，可下载标记版、详情版 Excel 和 ZIP。",
                status="ready",
                available=True,
                downloads=["marked", "detailed", "zip"],
            )

        if task.get("report_bundle") or self._has_persisted_report_bundle(current_user.id, task_id):
            return AuditReportResponse(
                task_id=task_id,
                message="报告已生成，可下载标记版、详情版 Excel 和 ZIP。",
                status="ready",
                available=True,
                downloads=["marked", "detailed", "zip"],
            )

        task_status = str(task.get("status") or "")
        if task_status == "failed":
            return AuditReportResponse(
                task_id=task_id,
                message="报告生成失败，请检查审核任务错误后重新运行。",
                status="failed",
                available=False,
            )
        if task_status == "completed":
            return AuditReportResponse(
                task_id=task_id,
                message="审核已完成，但报告未生成或已失效，请重新运行审核。",
                status="failed",
                available=False,
            )

        return AuditReportResponse(
            task_id=task_id,
            message="报告尚未生成，请先等待审核任务完成。",
            status="pending",
            available=False,
        )

    def get_history(
        self,
        current_user: CurrentUser,
        page: int = 1,
        page_size: int = 20,
    ) -> AuditHistoryListResponse:
        """读取当前用户的历史列表。"""

        page = max(page, 1)
        page_size = max(page_size, 1)
        if self.repo is not None:
            try:
                history_records = self.repo.list_audit_history(current_user.id, page=page, page_size=page_size)
            except Exception:
                logger.exception("Audit history list failed for user %s.", current_user.id)
                raise
            try:
                total_count = self.repo.count_audit_history(current_user.id)
            except Exception:
                logger.warning("Audit history count failed; returning list with unknown total.", exc_info=True)
                total_count = None
        else:
            all_records = self.store.audit_history.get(current_user.id, [])
            total_count = len(all_records)
            offset = (page - 1) * page_size
            history_records = all_records[offset : offset + page_size]

        items: list[AuditHistoryItem] = []
        for record in history_records:
            item = self._to_history_list_item(record)
            if item is not None:
                items.append(item)

        return AuditHistoryListResponse(
            items=items,
            total_count=total_count,
            page=page,
            page_size=page_size,
        )

    def get_history_detail(self, current_user: CurrentUser, history_id: str) -> AuditHistoryDetailResponse:
        """读取单条历史记录。"""

        if self.repo is not None:
            item = self.repo.get_audit_history(history_id, current_user.id)
            if item is not None:
                return AuditHistoryDetailResponse(item=item)
        else:
            for item in self.store.audit_history.get(current_user.id, []):
                if str(item["id"]) == history_id:
                    return AuditHistoryDetailResponse(item=item)
        raise AppError("未找到指定审核历史记录。", status_code=404)

    @classmethod
    def _to_history_list_item(cls, item: dict[str, Any]) -> AuditHistoryItem | None:
        history_id = item.get("id")
        if not history_id:
            logger.warning("Skipping audit history row without id in list response.")
            return None

        try:
            return AuditHistoryItem(
                id=str(history_id),
                model_used=str(item.get("model_used") or "unknown"),
                document_count=cls._safe_int(item.get("document_count")),
                red_count=cls._safe_int(item.get("red_count")),
                yellow_count=cls._safe_int(item.get("yellow_count")),
                blue_count=cls._safe_int(item.get("blue_count")),
                deep_think_used=bool(item.get("deep_think_used", False)),
                created_at=item.get("created_at"),
            )
        except Exception:
            logger.warning("Skipping malformed audit history row in list response.", exc_info=True)
            return None

    @staticmethod
    def _safe_int(value: Any, default: int = 0) -> int:
        if value in (None, ""):
            return default
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    async def _run_single_target_audit(
        self,
        *,
        user_id: str,
        index: int,
        target_item: dict[str, Any],
        task: dict[str, Any],
        po_record: dict[str, Any],
        prev_records: list[dict[str, Any]],
        template_record: dict[str, Any] | None,
        reference_records: list[dict[str, Any]],
        selected_model: str,
        primary_provider: str,
        target_count: int,
        deep_think: bool,
        custom_rules: list[str],
        audit_rules_text: str,
        company_affiliates: list[str],
        should_cancel: Callable[[], bool] | None,
        progress_callback: Callable[[int, str], Awaitable[None] | None] | None,
    ) -> dict[str, Any]:
        """对单个 target 文件执行完整审核链路。"""

        self._ensure_not_cancelled(should_cancel)

        profile = self._get_profile(user_id)
        target_record = self._ensure_runtime_file(target_item["file_id"])
        doc_type = self._resolve_doc_type(target_item.get("document_type"), target_record)
        prev_text = self._collect_previous_ticket_text(doc_type, prev_records)
        template_text = str(template_record.get("text", "")) if template_record else ""
        reference_texts = [str(record.get("text", "")) for record in reference_records if record.get("text")]
        provider_for_call = primary_provider
        model_for_call = selected_model
        needs_ocr = bool(target_record.get("needs_ocr")) and bool(target_record.get("page_images"))

        if needs_ocr:
            selected_ocr_provider, selected_ocr_model = self._select_ocr_provider(primary_provider, profile)
            if selected_ocr_provider != primary_provider:
                await self._notify_progress(
                    progress_callback,
                    15,
                    f"当前文档为扫描件，已自动切换至 {selected_ocr_provider} 视觉模型进行识别。",
                )
            provider_for_call = selected_ocr_provider
            model_for_call = selected_ocr_model
        user_api_key = self._require_profile_api_key(profile, provider_for_call)

        safe_limit = self.token_utils.get_safe_token_limit(model_for_call)
        if target_count <= 1:
            document_token_budget = max(512, safe_limit // 2)
        elif target_count <= 3:
            document_token_budget = max(512, safe_limit // 3)
        else:
            document_token_budget = max(512, safe_limit // 4)

        po_text_context, po_truncated = self._prepare_text_context(
            self._llm_text_for_record(task, po_record),
            model_for_call,
            document_token_budget,
        )
        target_text_context, target_truncated = self._prepare_text_context(
            self._llm_text_for_record(task, target_record),
            model_for_call,
            document_token_budget,
        )
        prev_text_context, _ = self._prepare_text_context(prev_text, model_for_call, document_token_budget)
        template_text_context, _ = self._prepare_text_context(template_text, model_for_call, document_token_budget)
        reference_text_contexts = [
            self._prepare_text_context(text, model_for_call, document_token_budget)[0]
            for text in reference_texts
        ]
        self._log_diag_text("po_text", po_text_context)
        self._log_diag_text("target_text", target_text_context)

        evidence_block = self._build_evidence_block(
            po_text_context,
            target_text_context,
            task=task,
            po_file_id=str(task.get("po_file_id") or "") or None,
            target_file_id=str(target_item.get("file_id") or "") or None,
        )

        messages = self.audit_engine.build_audit_prompt(
            po_text=po_text_context,
            target_text=target_text_context,
            target_type=doc_type,
            prev_ticket_text=prev_text_context,
            template_text=template_text_context,
            reference_texts=reference_text_contexts,
            company_affiliates=company_affiliates,
            deep_think=deep_think,
            audit_rules_text=audit_rules_text,
            evidence_block=evidence_block,
        )

        # 每次 LLM 调用前后都检查取消状态，并传入单次超时，避免取消审核后继续长时间等待同步 SDK。
        if needs_ocr:
            raw_response = await self._await_llm_call(
                lambda: self.llm_client.call_llm_with_image(
                    messages,
                    image_payloads=list(target_record.get("page_images", [])),
                    provider=provider_for_call,
                    requested_model=model_for_call,
                    api_key=user_api_key,
                    deep_think=deep_think,
                    timeout=self._LLM_SINGLE_CALL_TIMEOUT_SECONDS,
                ),
                should_cancel=should_cancel,
            )
        else:
            raw_response = await self._await_llm_call(
                lambda: self.llm_client.call_llm(
                    messages,
                    provider=provider_for_call,
                    requested_model=model_for_call,
                    api_key=user_api_key,
                    deep_think=deep_think,
                    timeout=self._LLM_SINGLE_CALL_TIMEOUT_SECONDS,
                ),
                should_cancel=should_cancel,
            )

        parsed_result = self.audit_engine.parse_audit_result(raw_response)
        self._store_raw_llm_issues(task, parsed_result)
        parsed_result = self._post_process_force_downgrade(parsed_result, company_affiliates)

        parsed_result = self._post_process_evidence_and_identifiers(
            parsed_result,
            po_text=po_text_context,
            target_text=target_text_context,
            doc_type=doc_type,
        )

        if po_truncated or target_truncated:
            self._append_truncation_notice(parsed_result, doc_type, index)

        enriched = self._attach_document_context(parsed_result, target_item, target_record, doc_type, index)
        enriched = self._resolve_issue_locations_for_result(enriched, task)
        return {
            "file_id": target_item["file_id"],
            "doc_type": doc_type,
            "provider": provider_for_call,
            "result": enriched,
        }

    def _resolve_doc_type(self, manual_type: str | None, file_record: dict[str, Any]) -> str:
        """手动类型优先，其次依据已解析出的 detected_type 和文件名提示。"""

        if manual_type:
            normalized_manual = manual_type.strip().lower()
            return "generic" if normalized_manual in _EXTENSION_FALLBACKS else normalized_manual

        detected_type = str(file_record.get("detected_type", "")).strip().lower()
        if detected_type in _DOC_TYPE_HINTS:
            return detected_type

        filename = str(file_record.get("filename", "")).lower()
        for doc_type, hints in _DOC_TYPE_HINTS.items():
            if doc_type == "invoice" and self._matches_invoice_filename(filename):
                return doc_type
            if doc_type == "po" and self._matches_po_filename(filename):
                return doc_type
            if doc_type not in {"invoice", "po"} and any(hint in filename for hint in hints):
                return doc_type

        if detected_type in _EXTENSION_FALLBACKS:
            return "generic"
        return detected_type or "generic"

    def _select_ocr_provider(self, primary_provider: str, profile: dict[str, Any]) -> tuple[str, str]:
        """当主 provider 不适合视觉/OCR 时，选择降级/切换 provider。"""

        if primary_provider != "deepseek":
            return primary_provider, self.llm_client._resolve_model(provider=primary_provider, vision=True)
        if self._get_profile_api_key(profile, "zhipuai"):
            return "zhipuai", self.llm_client._resolve_model(provider="zhipuai", vision=True)
        if self._get_profile_api_key(profile, "openai"):
            return "openai", self.llm_client._resolve_model(provider="openai", vision=True)
        raise AppError("当前扫描件需要视觉/OCR 模型，但未配置可用的 OpenAI 或智谱 API Key。", status_code=400)

    def _collect_previous_ticket_text(self, doc_type: str, prev_records: list[dict[str, Any]]) -> str:
        """收集上一票文本，优先拼出和当前 doc_type 相关的上下文。"""

        typed_matches = [
            str(record.get("text", ""))
            for record in prev_records
            if self._resolve_doc_type(None, record) == doc_type and record.get("text")
        ]
        if typed_matches:
            return "\n\n".join(typed_matches)
        fallback_matches = [str(record.get("text", "")) for record in prev_records if record.get("text")]
        return "\n\n".join(fallback_matches)

    @staticmethod
    def _llm_text_for_record(task: dict[str, Any], record: dict[str, Any]) -> str:
        """Use coordinate-rich cell text for .xlsx files when a cell index is available."""

        file_id = str(record.get("id") or "")
        extension = str(record.get("extension") or Path(str(record.get("filename", ""))).suffix.lstrip(".")).lower()
        if file_id and extension == "xlsx":
            cell_index = dict(task.get("cell_indexes") or {}).get(file_id)
            if isinstance(cell_index, list) and cell_index:
                formatted = format_cell_index_for_llm(cell_index)
                if formatted.strip():
                    return formatted
        return str(record.get("text", ""))

    def _prepare_text_context(self, text: str, model: str, max_tokens: int) -> tuple[str, bool]:
        """根据 token 安全上限控制输入文本大小。"""

        token_budget = max(512, max_tokens)
        normalized_text = text or ""
        was_truncated = self.token_utils.estimate_tokens(normalized_text, model) > token_budget
        truncated_text = self.token_utils.truncate_text(normalized_text, max_tokens=token_budget, model=model)
        return truncated_text, was_truncated

    @staticmethod
    def _matches_invoice_filename(filename: str) -> bool:
        name = filename.lower()
        stem = name.rsplit(".", 1)[0].replace(" ", "_").replace(".", "_")
        if "commercial_invoice" in stem or "invoice" in stem:
            return True
        if stem.startswith(("ci-", "ci_", "commercial")):
            return True
        if "-ci-" in stem or "_ci_" in stem:
            return True
        return bool(re.search(r"(?:^|[-_\s])inv(?:$|[-_\s])", stem, flags=re.IGNORECASE))

    @staticmethod
    def _matches_po_filename(filename: str) -> bool:
        name = filename.lower()
        stem = name.rsplit(".", 1)[0].replace(" ", "_").replace(".", "_")
        if "purchase_order" in stem:
            return True
        return bool(re.search(r"(?:^|[-_\s])po(?:$|[-_\s])", stem, flags=re.IGNORECASE))

    @staticmethod
    def _collect_diag_hits(text: str, keywords: tuple[str, ...] = _DIAG_KEYWORDS) -> dict[str, int]:
        lowered = (text or "").lower()
        hits: dict[str, int] = {}
        for keyword in keywords:
            count = lowered.count(keyword.lower())
            if count:
                hits[keyword] = count
        return hits

    @staticmethod
    def _collect_diag_snippets(
        text: str,
        keywords: tuple[str, ...] = _DIAG_KEYWORDS,
        *,
        radius: int = 120,
    ) -> dict[str, list[str]]:
        snippets: dict[str, list[str]] = {}
        source = text or ""
        lowered = source.lower()
        for keyword in keywords:
            index = lowered.find(keyword.lower())
            if index < 0:
                continue
            start = max(0, index - radius)
            end = min(len(source), index + len(keyword) + radius)
            snippets[keyword] = [source[start:end].replace("\n", "\\n")]
        return snippets

    @classmethod
    def _log_diag_text(cls, label: str, text: str) -> None:
        source = text or ""
        hits = cls._collect_diag_hits(source)
        logger.info("DIAG %s len=%d keyword_hits=%s", label, len(source), sorted(hits))
        if os.getenv("AUDIT_DEBUG_DIAG", "").lower() == "true":
            logger.info("DIAG %s snippets=%s", label, cls._collect_diag_snippets(source))

    def _build_evidence_block(
        self,
        po_text: str,
        target_text: str,
        *,
        task: dict[str, Any] | None = None,
        po_file_id: str | None = None,
        target_file_id: str | None = None,
    ) -> str:
        po_fields = self._extract_key_fields(po_text, source="po")
        target_fields = self._extract_key_fields(target_text, source="target")

        lines = ["=== 系统预提取关键字段（仅供参考，以原文为准）==="]
        if po_fields:
            lines.append("PO/基准单据:")
            for key, label in (
                ("contract_no", "Contract No."),
                ("unit_price", "Unit Price"),
                ("quantity", "Quantity"),
                ("packing", "Packing"),
                ("amount", "Amount"),
            ):
                if po_fields.get(key):
                    lines.append(f"- {label}: {po_fields[key]}")
        if target_fields:
            lines.append("目标单据:")
            for key, label in (
                ("invoice_no", "Invoice No."),
                ("po_no", "PO No."),
                ("unit_price", "Unit Price"),
                ("quantity", "Quantity"),
                ("amount", "Total Value"),
            ):
                if target_fields.get(key):
                    lines.append(f"- {label}: {target_fields[key]}")
        lines.append("===")
        if not po_fields and not target_fields:
            return ""
        return "\n".join(lines)

    def _extract_fields_from_cell_index(self, cell_index: list[dict]) -> dict[str, list[dict]]:
        fields: dict[str, list[dict]] = {}
        for record in cell_index:
            sheet = str(record.get("sheet") or "")
            cell = str(record.get("cell") or "")
            value = str(record.get("value_str") or "").strip()
            label = str(record.get("left_label") or "").strip()
            if not value or not label:
                continue

            label_lower = label.lower()
            for field_key, keywords in _EVIDENCE_FIELD_LABELS.items():
                if any(keyword.lower() in label_lower for keyword in keywords):
                    fields.setdefault(field_key, []).append(
                        {
                            "sheet": sheet,
                            "cell": cell,
                            "label": label,
                            "value": value,
                        }
                    )
        return fields

    def _format_extracted_fields(self, label: str, extracted: dict[str, list[dict]]) -> str:
        if not extracted:
            return ""

        display_names = {
            "contract_no": "合同号",
            "invoice_no": "发票号",
            "po_no": "PO号/订单号",
            "unit_price": "单价",
            "quantity": "数量",
            "amount": "金额",
            "packing": "包装",
            "currency": "币种",
            "buyer": "买方",
            "seller": "卖方",
            "incoterm": "贸易术语",
        }
        lines: list[str] = []

        for field_key, records in extracted.items():
            if not isinstance(records, list):
                continue

            display_name = display_names.get(field_key, field_key)
            for record in records:
                if not isinstance(record, dict):
                    continue

                sheet = str(record.get("sheet") or "").strip()
                cell = str(record.get("cell") or "").strip()
                value = str(record.get("value") or "").strip()
                if not value:
                    continue

                source = f"{sheet}!{cell}" if sheet and cell else "未知位置"
                lines.append(f"{display_name}: {value} (来源: {source})")

        if not lines:
            return ""

        title = f"【系统预提取关键字段：{label}】"
        return "\n".join([title, *lines])

    @classmethod
    def _extract_key_fields(cls, text: str, *, source: str) -> dict[str, str]:
        fields: dict[str, str] = {}
        wanted = (
            ("contract_no", "unit_price", "quantity", "packing", "amount")
            if source == "po"
            else ("invoice_no", "po_no", "unit_price", "quantity", "amount")
        )
        for key in wanted:
            value = cls._extract_field_value(text, _EVIDENCE_FIELD_LABELS[key])
            if value:
                fields[key] = value
        return fields

    @classmethod
    def _extract_field_value(cls, text: str, labels: tuple[str, ...]) -> str:
        lines = [line.strip() for line in (text or "").splitlines() if line.strip()]
        table_value = cls._extract_field_from_table(lines, labels)
        if table_value:
            return table_value

        for line in lines:
            cells = cls._split_table_line(line)
            for index, cell in enumerate(cells[:-1]):
                if cls._cell_matches_any_label(cell, labels) and not cls._cell_matches_known_label(cells[index + 1]):
                    return cls._clean_field_value(cells[index + 1])

            regex_value = cls._extract_field_from_line(line, labels)
            if regex_value:
                return regex_value
        return ""

    @classmethod
    def _extract_field_from_table(cls, lines: list[str], labels: tuple[str, ...]) -> str:
        for index, line in enumerate(lines[:-1]):
            cells = cls._split_table_line(line)
            if len(cells) < 2 or cls._count_known_labels(cells) < 2:
                continue
            next_cells = cls._split_table_line(lines[index + 1])
            for cell_index, cell in enumerate(cells):
                if cls._cell_matches_any_label(cell, labels) and cell_index < len(next_cells):
                    value = cls._clean_field_value(next_cells[cell_index])
                    if value and not cls._cell_matches_known_label(value):
                        return value
        return ""

    @staticmethod
    def _split_table_line(line: str) -> list[str]:
        return [cell.strip() for cell in line.split("|") if cell.strip()]

    @classmethod
    def _extract_field_from_line(cls, line: str, labels: tuple[str, ...]) -> str:
        for label in labels:
            escaped = re.escape(label)
            pattern = rf"{escaped}\s*(?:[:：#-]|\s)\s*([^|。；;\n]{{1,80}})"
            match = re.search(pattern, line, flags=re.IGNORECASE)
            if match:
                value = cls._clean_field_value(match.group(1))
                if value and not cls._cell_matches_known_label(value):
                    return value
        return ""

    @classmethod
    def _count_known_labels(cls, cells: list[str]) -> int:
        return sum(1 for cell in cells if cls._cell_matches_known_label(cell))

    @classmethod
    def _cell_matches_known_label(cls, cell: str) -> bool:
        return any(
            cls._cell_matches_any_label(cell, labels)
            for labels in _EVIDENCE_FIELD_LABELS.values()
        )

    @staticmethod
    def _normalize_label(value: str) -> str:
        return re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "", (value or "").lower())

    @classmethod
    def _cell_matches_any_label(cls, cell: str, labels: tuple[str, ...]) -> bool:
        normalized_cell = cls._normalize_label(cell)
        if not normalized_cell:
            return False
        return any(cls._normalize_label(label) in normalized_cell for label in labels)

    @staticmethod
    def _clean_field_value(value: str) -> str:
        return (value or "").strip().strip("|;；,，。")

    @classmethod
    def _extract_explicit_unit_price(cls, text: str) -> str:
        value = cls._extract_field_value(text, _EVIDENCE_FIELD_LABELS["unit_price"])
        if value and any(char.isdigit() for char in value):
            return value
        return ""

    @classmethod
    def _parse_decimal(cls, value: str) -> Decimal | None:
        match = re.search(r"\d[\d,]*(?:\.\d+)?", value or "")
        if not match:
            return None
        try:
            return Decimal(match.group(0).replace(",", ""))
        except InvalidOperation:
            return None

    @staticmethod
    def _extract_currency(*values: str) -> str:
        for value in values:
            match = re.search(r"\b(USD|EUR|CNY|RMB|GBP|JPY|HKD)\b", value or "", flags=re.IGNORECASE)
            if match:
                return match.group(1).upper()
        return ""

    @staticmethod
    def _format_decimal(value: Decimal) -> str:
        quantized = value.quantize(Decimal("0.01"))
        text = f"{quantized:,.2f}"
        return text[:-3] if text.endswith(".00") else text

    def _append_truncation_notice(self, parsed_result: dict[str, Any], doc_type: str, index: int) -> None:
        """在结果末尾追加长文档截断提醒。"""

        issues = parsed_result.get("issues")
        if not isinstance(issues, list):
            issues = []
            parsed_result["issues"] = issues

        issues.append(
            {
                "id": f"{doc_type}-{index}-truncation-notice",
                "level": "BLUE",
                "field_name": "document_coverage",
                "finding": "本文档原文较长，系统仅截取了前部分内容进行审核，未覆盖部分可能包含需要人工复核的信息。",
                "suggestion": "建议人工检查本文档后半部分内容，确认无遗漏。",
                "confidence": 1.0,
            }
        )
        parsed_result["summary"] = self._recount_summary(
            [issue for issue in issues if isinstance(issue, dict)]
        )

    def _post_process_evidence_and_identifiers(
        self,
        parsed_result: dict[str, Any],
        *,
        po_text: str,
        target_text: str,
        doc_type: str,
    ) -> dict[str, Any]:
        """Clean unsafe evidence wording and protect independent core identifier findings."""

        issues = parsed_result.get("issues")
        if not isinstance(issues, list):
            issues = []
            parsed_result["issues"] = issues

        for issue in issues:
            if not isinstance(issue, dict):
                continue
            for key in ("finding", "message", "suggestion", "reason"):
                value = issue.get(key)
                if isinstance(value, str):
                    issue[key] = self.audit_engine._sanitize_evidence_wording(value)
            self._retitle_unit_price_issue(issue)

        self._ensure_core_identifier_issues(issues, po_text=po_text, target_text=target_text, doc_type=doc_type)
        self._ensure_unit_price_issue(issues, po_text=po_text, target_text=target_text, doc_type=doc_type)
        parsed_result["summary"] = self._recount_summary(
            [issue for issue in issues if isinstance(issue, dict)]
        )
        return parsed_result

    @staticmethod
    def _retitle_unit_price_issue(issue: dict[str, Any]) -> None:
        text = " ".join(
            str(issue.get(key, ""))
            for key in ("field_name", "title", "finding", "message", "suggestion", "your_value", "source_value")
        ).lower()
        if "单价" in text and any(keyword in text for keyword in ("不一致", "错误", "不匹配", "不符")):
            issue["field_name"] = "单价不一致"
            if issue.get("title"):
                issue["title"] = "单价不一致"
            if str(issue.get("level", "")).upper() != "RED":
                issue["level"] = "RED"

    def _ensure_unit_price_issue(
        self,
        issues: list[Any],
        *,
        po_text: str,
        target_text: str,
        doc_type: str,
    ) -> None:
        po_unit_price = self._extract_explicit_unit_price(po_text)
        target_unit_price = self._extract_explicit_unit_price(target_text)
        po_unit_number = self._parse_decimal(po_unit_price)
        target_unit_number = self._parse_decimal(target_unit_price)
        if po_unit_number is None or target_unit_number is None or po_unit_number == target_unit_number:
            return

        finding = (
            f"PO/基准单据 Unit Price 为 {po_unit_price}，目标单据 Unit Price 为 {target_unit_price}，两者不一致。"
        )
        suggestion = "请核对并修正目标单据单价，或补充单价差异依据。"
        rebuilt_issue = {
            "id": f"{doc_type}-unit-price-mismatch",
            "level": "RED",
            "field_name": "单价不一致",
            "finding": finding,
            "message": finding,
            "suggestion": suggestion,
            "confidence": 1.0,
            "your_value": target_unit_price,
            "source_value": po_unit_price,
            "matched_po_value": po_unit_price,
            "observed_value": target_unit_price,
            "source": "PO/基准单据 Unit Price",
            "field_location": "Unit Price",
        }

        existing_index = self._find_unit_price_related_issue_index(issues)
        if existing_index is None:
            issues.append(rebuilt_issue)
        else:
            issue = issues[existing_index]
            if isinstance(issue, dict):
                existing_id = issue.get("id")
                issue.clear()
                issue.update(rebuilt_issue)
                if existing_id:
                    issue["id"] = existing_id

    @staticmethod
    def _find_unit_price_related_issue_index(issues: list[Any]) -> int | None:
        for index, issue in enumerate(issues):
            if not isinstance(issue, dict):
                continue
            text = " ".join(
                str(issue.get(key, ""))
                for key in (
                    "field_name",
                    "finding",
                    "message",
                    "suggestion",
                    "reason",
                    "your_value",
                    "source_value",
                    "matched_po_value",
                    "observed_value",
                )
            ).lower()
            if any(keyword in text for keyword in ("单价", "unit price", "金额计算", "金额计算矛盾", "总金额", "total value")):
                return index
        return None

    def _ensure_core_identifier_issues(
        self,
        issues: list[Any],
        *,
        po_text: str,
        target_text: str,
        doc_type: str,
    ) -> None:
        target_normalized = self._normalize_identifier_text(target_text)
        has_target_identifier_evidence = self._has_usable_target_identifier_evidence(target_text)
        for spec in _CORE_IDENTIFIER_SPECS:
            field_name = str(spec["field_name"])
            issue_key = str(spec["issue_key"])
            values = self._extract_identifier_values(po_text, spec["patterns"])
            for value in values:
                normalized_value = self._normalize_identifier_text(value)
                if not normalized_value or normalized_value in target_normalized:
                    continue
                if self._has_identifier_issue(issues, field_name, value):
                    continue
                if has_target_identifier_evidence:
                    level = "RED"
                    finding = f"PO 中明确包含{field_name} {value}，但目标单据中未显示该编号，属于核心编号缺失。"
                    suggestion = f"请核对目标单据并补充或修正{field_name}，避免核心编号无法对应。"
                    confidence = 1.0
                else:
                    level = "YELLOW"
                    finding = f"PO 中明确包含{field_name} {value}，但目标单据文本中未能确认是否包含该编号。"
                    suggestion = f"请人工核对目标单据中的{field_name}，确认该核心编号是否已正确列示。"
                    confidence = 0.55
                issues.append(
                    {
                        "id": f"{doc_type}-{issue_key}-missing",
                        "level": level,
                        "field_name": field_name,
                        "finding": finding,
                        "message": finding,
                        "suggestion": suggestion,
                        "confidence": confidence,
                    }
                )

    @staticmethod
    def _extract_identifier_values(text: str, patterns: Any) -> list[str]:
        values: list[str] = []
        for pattern in patterns:
            for match in re.finditer(str(pattern), text or "", flags=re.IGNORECASE):
                value = match.group(1).strip().strip(".,;，。；)")
                if AuditOrchestratorService._looks_like_identifier(value) and value not in values:
                    values.append(value)
        return values

    @staticmethod
    def _looks_like_identifier(value: str) -> bool:
        normalized = AuditOrchestratorService._normalize_identifier_text(value)
        if len(normalized) < 4:
            return False
        if not any(char.isdigit() for char in normalized):
            return False
        blocked_values = {"USD", "EUR", "CNY", "RMB", "KGS", "KG", "PCS", "CTNS"}
        return normalized not in blocked_values

    @staticmethod
    def _has_usable_target_identifier_evidence(text: str) -> bool:
        normalized = AuditOrchestratorService._normalize_identifier_text(text)
        if len(normalized) < 20:
            return False
        return any(char.isdigit() for char in normalized)

    @staticmethod
    def _normalize_identifier_text(value: str) -> str:
        return re.sub(r"[^A-Z0-9]", "", (value or "").upper())

    @staticmethod
    def _has_identifier_issue(issues: list[Any], field_name: str, value: str) -> bool:
        normalized_value = AuditOrchestratorService._normalize_identifier_text(value)
        for issue in issues:
            if not isinstance(issue, dict):
                continue
            text = " ".join(
                str(issue.get(key, ""))
                for key in ("field_name", "finding", "message", "suggestion", "matched_po_value", "observed_value")
            )
            normalized_text = AuditOrchestratorService._normalize_identifier_text(text)
            if normalized_value and normalized_value in normalized_text:
                return True
            if field_name in text and any(keyword in text for keyword in ("缺失", "未显示", "不一致", "冲突", "无法确认")):
                return True
        return False

    @staticmethod
    def _store_raw_llm_issues(task: dict[str, Any], parsed_result: dict[str, Any]) -> None:
        raw_issues = task.setdefault("llm_raw_issues", [])
        if not isinstance(raw_issues, list):
            raw_issues = []
            task["llm_raw_issues"] = raw_issues

        for issue in parsed_result.get("issues", []):
            if not isinstance(issue, dict):
                continue
            raw_issues.append(copy.deepcopy(issue.get("raw_llm_issue") or issue))

    def _resolve_issue_locations_for_result(
        self,
        parsed_result: dict[str, Any],
        task: dict[str, Any],
    ) -> dict[str, Any]:
        issues = parsed_result.get("issues", [])
        if not isinstance(issues, list):
            parsed_result["issues"] = []
            return parsed_result

        file_records = self._uploaded_file_records_for_task(task)
        cell_indexes = dict(task.get("cell_indexes") or {})
        resolved_issues: list[Any] = []
        for issue in issues:
            if not isinstance(issue, dict):
                resolved_issues.append(issue)
                continue
            resolved_issue = copy.deepcopy(issue)
            locations, mark_status, mark_reason_code, mark_reason = resolve_issue_locations(
                resolved_issue,
                cell_indexes,
                file_records,
            )
            resolved_issue["locations"] = locations
            resolved_issue["mark_status"] = mark_status
            resolved_issue["mark_reason_code"] = mark_reason_code
            resolved_issue["mark_reason"] = mark_reason
            resolved_issues.append(resolved_issue)

        parsed_result["issues"] = resolved_issues
        return parsed_result

    def _uploaded_file_records_for_task(self, task: dict[str, Any]) -> dict[str, dict[str, Any]]:
        records: dict[str, dict[str, Any]] = {}
        for file_id in self._collect_task_file_ids(task):
            record = self.store.files.get(file_id)
            if isinstance(record, dict):
                records[file_id] = record
        return records

    def _attach_document_context(
        self,
        parsed_result: dict[str, Any],
        target_item: dict[str, Any],
        target_record: dict[str, Any],
        doc_type: str,
        index: int,
    ) -> dict[str, Any]:
        """把文件上下文补回每条 issue，便于后续报告和历史使用。"""

        issues = parsed_result.get("issues", [])
        for issue_index, issue in enumerate(issues, start=1):
            if not isinstance(issue, dict):
                continue
            issue["id"] = issue.get("id") or f"{doc_type}-{index + 1}-{issue_index:03d}"
            issue["document_type"] = doc_type
            issue["file_id"] = target_item["file_id"]
            issue["document_label"] = target_item.get("label") or target_record.get("filename", "")
            if "message" not in issue:
                issue["message"] = str(issue.get("finding", ""))
        return parsed_result

    def _prepare_xlsx_task_context(
        self,
        task: dict[str, Any],
        file_records: list[dict[str, Any]],
    ) -> None:
        """Write original .xlsx files to the task temp dir and build in-memory cell indexes."""

        task_id = str(task.get("task_id") or "unknown")
        cell_indexes = task.setdefault("cell_indexes", {})
        original_xlsx_paths = task.setdefault("original_xlsx_paths", {})

        unique_records: dict[str, dict[str, Any]] = {}
        for record in file_records:
            if not isinstance(record, dict):
                continue
            file_id = str(record.get("id") or "")
            if file_id:
                unique_records[file_id] = record

        for file_id, record in unique_records.items():
            extension = str(record.get("extension") or Path(str(record.get("filename", ""))).suffix.lstrip(".")).lower()
            if extension != "xlsx":
                cell_indexes.setdefault(file_id, [])
                continue

            raw_bytes = record.get("raw_bytes")
            if not isinstance(raw_bytes, (bytes, bytearray)):
                logger.warning(
                    "XLSX original bytes are unavailable for task %s file_id=%s filename=%s",
                    task_id,
                    file_id,
                    record.get("filename"),
                )
                cell_indexes.setdefault(file_id, [])
                continue

            temp_dir = self._ensure_task_temp_dir(task)
            filename = Path(str(record.get("filename") or "workbook.xlsx")).name or "workbook.xlsx"
            safe_filename = re.sub(r"[^A-Za-z0-9._-]+", "_", filename)
            xlsx_path = Path(temp_dir) / f"{file_id}_{safe_filename}"
            if not xlsx_path.exists():
                xlsx_path.write_bytes(bytes(raw_bytes))

            path_text = str(xlsx_path)
            original_xlsx_paths[file_id] = path_text
            record["original_xlsx_path"] = path_text

            if file_id not in cell_indexes:
                cell_indexes[file_id] = build_cell_index(
                    path_text,
                    file_id=file_id,
                    file_name=str(record.get("filename") or filename),
                )

    @staticmethod
    def _ensure_task_temp_dir(task: dict[str, Any]) -> str:
        temp_dir = task.get("audit_temp_dir")
        if temp_dir and Path(str(temp_dir)).exists():
            return str(temp_dir)

        task_id = str(task.get("task_id") or "unknown")
        task["audit_temp_dir"] = tempfile.mkdtemp(prefix=f"audit_{task_id}_")
        return str(task["audit_temp_dir"])

    def _post_process_force_downgrade(
        self,
        parsed_result: dict[str, Any],
        company_affiliates: list[str] | None,
    ) -> dict[str, Any]:
        """仅在严格条件下把部分 RED 降为 YELLOW。"""

        affiliates = company_affiliates or []
        issues = parsed_result.get("issues", [])
        for issue in issues:
            if not isinstance(issue, dict):
                continue
            if str(issue.get("level", "")).upper() != "RED":
                continue

            field_name = str(issue.get("field_name", "")).strip().lower()
            if field_name in _DOWNGRADE_ALLOWED_FIELDS:
                finding_text = " ".join(
                    str(issue.get(key, "")) for key in ("finding", "suggestion", "message")
                )
                if self._is_affiliate_match(
                    field_name=field_name,
                    observed_value=str(issue.get("observed_value", "")),
                    matched_po_value=str(issue.get("matched_po_value", "")),
                    finding_text=finding_text,
                    company_affiliates=affiliates,
                ):
                    issue["level"] = "YELLOW"
                    issue["message"] = str(issue.get("finding") or issue.get("message", ""))

        parsed_result["summary"] = self._recount_summary(issues)
        return parsed_result

    def _is_affiliate_match(
        self,
        *,
        field_name: str,
        observed_value: str,
        matched_po_value: str,
        finding_text: str,
        company_affiliates: list[str],
    ) -> bool:
        """判断是否满足允许降级的集团关联主体规则。"""

        if field_name not in _DOWNGRADE_ALLOWED_FIELDS:
            return False
        if any(blocked in field_name for blocked in _DOWNGRADE_BLOCKED_KEYWORDS):
            return False

        finding_lower = finding_text.lower()
        fallback_hints = ("affiliate", "group company", "same group", "关联公司", "集团内")
        if any(hint in finding_lower for hint in fallback_hints):
            return True

        normalized_affiliates = [self._normalize_affiliate_text(item) for item in company_affiliates if item]
        if not normalized_affiliates:
            return False

        observed = self._normalize_affiliate_text(observed_value)
        matched = self._normalize_affiliate_text(matched_po_value)
        return any(affiliate in observed or affiliate in matched for affiliate in normalized_affiliates if affiliate)

    @staticmethod
    def _collect_task_file_ids(task: dict[str, Any]) -> list[str]:
        """收集当前审核任务实际引用过的 file_id。"""

        file_ids: list[str] = []

        def _append(file_id: Any) -> None:
            if file_id:
                file_ids.append(str(file_id))

        _append(task.get("po_file_id"))
        for item in task.get("target_files", []):
            if isinstance(item, dict):
                _append(item.get("file_id"))
        for item in task.get("prev_ticket_files", []):
            if isinstance(item, dict):
                _append(item.get("file_id"))
        _append(task.get("template_file_id"))
        for file_id in task.get("reference_file_ids", []):
            _append(file_id)

        return list(dict.fromkeys(file_ids))

    async def _run_task(self, task_id: str) -> None:
        """后台任务入口。"""

        task = self.store.audit_tasks[task_id]
        user_id = str(task["user_id"])
        try:
            await self._update_task(task, "running", 5, "正在准备审核任务。")
            result_bundle = await self.run_full_audit(
                user_id=user_id,
                task_id=task_id,
                progress_callback=lambda progress, message: self._update_task(task, "running", progress, message),
                should_cancel=lambda: bool(task.get("cancel_requested")),
            )

            aggregate_result = result_bundle["aggregate_result"]
            report_bundle = result_bundle["report_bundle"]
            task["full_result"] = aggregate_result
            task["report_bundle"] = report_bundle
            task["result"] = self._to_api_result(
                task_id,
                aggregate_result,
                rule_snapshot=self._result_rule_snapshot_from_task(task),
            )
            task["status"] = "completed"
            task["progress_percent"] = 100
            task["message"] = "审核任务已完成。"
            task["updated_at"] = datetime.now(timezone.utc)
            report_paths: dict[str, str] = {}
            if self.repo is not None and result_bundle.get("report_bundle"):
                report_paths = self._upload_reports_to_storage(
                    task_id=task_id,
                    user_id=user_id,
                    report_bundle=result_bundle["report_bundle"],
                )
                task["report_paths"] = report_paths

            history_item = {
                "id": str(uuid4()),
                "user_id": user_id,
                "task_id": task_id,
                "report_paths": report_paths if report_paths else None,
                "document_count": len(task["target_files"]) + 1,
                "red_count": aggregate_result["summary"]["red"],
                "yellow_count": aggregate_result["summary"]["yellow"],
                "blue_count": aggregate_result["summary"]["blue"],
                "audit_result": aggregate_result,
                "model_used": str(result_bundle["provider"]),
                "custom_rules_snapshot": list(task["custom_rules"]),
                "audit_rule_snapshot": task.get("audit_rule_snapshot"),
                "deep_think_used": bool(task["deep_think"]),
                "created_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
            }
            self.store.audit_history.setdefault(user_id, []).insert(0, history_item)
            if self.repo is not None:
                try:
                    persisted_history = self.repo.create_audit_history(user_id, history_item)
                    self.store.audit_history[user_id][0] = persisted_history
                except Exception:
                    logger.warning("Audit history persistence failed; keeping RuntimeStore history only.", exc_info=True)
            task["full_result"] = None
            self.file_parser.delete_files_by_ids(user_id, self._collect_task_file_ids(task))
        except asyncio.CancelledError:
            await self._finalize_cancel(task)
        except AppError as exc:
            task["status"] = "failed"
            task["message"] = _safe_user_facing_task_message(getattr(exc, "message_text", exc.message))
            task["updated_at"] = datetime.now(timezone.utc)
        except Exception as exc:  # pragma: no cover
            logger.exception("Audit task %s failed with an unexpected exception.", task_id)
            task["status"] = "failed"
            task["message"] = _USER_FACING_AUDIT_SYSTEM_ERROR_MESSAGE
            task["updated_at"] = datetime.now(timezone.utc)
        finally:
            temp_dir = task.get("audit_temp_dir")
            if temp_dir:
                shutil.rmtree(str(temp_dir), ignore_errors=True)  # AUDIT_TEMP_CLEANUP
                task["audit_temp_dir"] = None

    @staticmethod
    def _result_rule_snapshot_from_task(task: dict[str, Any]) -> dict[str, Any] | None:
        snapshot = task.get("audit_rule_snapshot")
        if not isinstance(snapshot, dict):
            return None

        company_affiliates = task.get("company_affiliates")
        if "company_affiliates" in snapshot or not isinstance(company_affiliates, list):
            return snapshot

        return {
            **snapshot,
            "company_affiliates": [str(item) for item in company_affiliates if str(item).strip()],
        }

    def _to_api_result(
        self,
        task_id: str,
        aggregate_result: dict[str, Any],
        *,
        rule_snapshot: dict[str, Any] | None = None,
    ) -> AuditResultResponse:
        """把完整审核结果收敛成当前 API 响应模型。"""

        def optional_issue_text(issue: dict[str, Any], key: str) -> str | None:
            value = issue.get(key)
            if value in (None, ""):
                return None

            text = str(value).strip()
            return text or None

        api_issues = [
            AuditIssue(
                id=optional_issue_text(issue, "id"),
                level=str(issue.get("level", "YELLOW")).upper(),
                field_name=str(issue.get("field_name", "unspecified_field")),
                message=str(issue.get("finding") or issue.get("message", "")),
                confidence=float(issue.get("confidence")) if issue.get("confidence") is not None else None,
                suggestion=str(issue.get("suggestion")).strip() if issue.get("suggestion") else None,
                document_label=str(issue.get("document_label")).strip() if issue.get("document_label") else None,
                document_type=optional_issue_text(issue, "document_type"),
                file_id=optional_issue_text(issue, "file_id"),
                matched_po_value=optional_issue_text(issue, "matched_po_value"),
                observed_value=optional_issue_text(issue, "observed_value"),
                source_excerpt=optional_issue_text(issue, "source_excerpt"),
                your_value=optional_issue_text(issue, "your_value"),
                source_value=optional_issue_text(issue, "source_value"),
                source=optional_issue_text(issue, "source"),
                field_location=optional_issue_text(issue, "field_location"),
                location_hints=[
                    str(item)
                    for item in issue.get("location_hints", [])
                    if str(item).strip()
                ]
                if isinstance(issue.get("location_hints"), list)
                else [],
                locations=[
                    item
                    for item in issue.get("locations", [])
                    if isinstance(item, dict)
                ],
                mark_status=optional_issue_text(issue, "mark_status"),
                mark_reason_code=optional_issue_text(issue, "mark_reason_code"),
                mark_reason=optional_issue_text(issue, "mark_reason"),
            )
            for issue in aggregate_result.get("issues", [])
            if isinstance(issue, dict)
        ]
        return AuditResultResponse(
            task_id=task_id,
            status="completed",
            summary={
                "red": int(aggregate_result.get("summary", {}).get("red", 0)),
                "yellow": int(aggregate_result.get("summary", {}).get("yellow", 0)),
                "blue": int(aggregate_result.get("summary", {}).get("blue", 0)),
            },
            issues=api_issues,
            rule_snapshot=rule_snapshot,
            message="审核结果已生成，完整结构已进入后续报告与历史流水线。",
        )

    def _aggregate_results(self, document_results: list[dict[str, Any]]) -> dict[str, Any]:
        """把逐文件审核结果聚合成总结果。"""

        all_issues: list[dict[str, Any]] = []
        for item in document_results:
            result = item.get("result", {})
            issues = result.get("issues", []) if isinstance(result, dict) else []
            for issue in issues:
                if isinstance(issue, dict):
                    all_issues.append(issue)

        summary = self._recount_summary(all_issues)
        confidence_values = [
            float(issue.get("confidence", 0.5))
            for issue in all_issues
            if isinstance(issue, dict)
        ]
        overall_confidence = sum(confidence_values) / len(confidence_values) if confidence_values else 0.5
        notes = [self._build_user_facing_audit_note(summary, all_issues)]

        return {
            "summary": summary,
            "issues": all_issues,
            "confidence": overall_confidence,
            "documents": document_results,
            "notes": notes,
        }

    @staticmethod
    def _build_user_facing_audit_note(
        summary: dict[str, int],
        issues: list[dict[str, Any]],
    ) -> str:
        total = len(issues)
        if total == 0:
            return "本次审核未发现明确问题，可结合原始单据进行最终确认。"

        parts: list[str] = []
        red = int(summary.get("red", 0))
        yellow = int(summary.get("yellow", 0))
        blue = int(summary.get("blue", 0))
        if red:
            parts.append(f"高风险 {red} 个")
        if yellow:
            parts.append(f"疑点 {yellow} 个")
        if blue:
            parts.append(f"提示 {blue} 个")

        focus_fields = AuditOrchestratorService._summarize_focus_fields(issues)
        focus_text = f"建议优先核对{focus_fields}。" if focus_fields else "建议按风险等级逐项核对并修正。"
        severity_text = f"，其中{'、'.join(parts)}" if parts else ""
        return f"本次审核共发现 {total} 个问题{severity_text}。{focus_text}"

    @staticmethod
    def _summarize_focus_fields(issues: list[dict[str, Any]]) -> str:
        labels: list[str] = []
        keyword_labels = (
            ("金额", ("金额", "总价", "总金额", "total", "amount")),
            ("单价", ("单价", "unit price")),
            ("数量", ("数量", "quantity", "qty")),
            ("币种", ("币种", "currency")),
            ("合同号", ("合同号", "合同编号", "contract no", "contract number")),
            ("订单号/PO号", ("订单号", "订单编号", "po号", "po no", "po number", "order no")),
            ("发票号", ("发票号", "发票号码", "invoice no", "invoice number")),
            ("提单号", ("提单号", "bill of lading", "b/l")),
            ("交易主体", ("主体", "买方", "卖方", "buyer", "seller")),
        )

        high_priority = [
            issue
            for issue in issues
            if isinstance(issue, dict) and str(issue.get("level", "")).upper() == "RED"
        ] or issues

        for issue in high_priority:
            text = " ".join(
                str(issue.get(key, ""))
                for key in ("field_name", "finding", "message", "suggestion")
            ).lower()
            for label, keywords in keyword_labels:
                if label not in labels and any(keyword in text for keyword in keywords):
                    labels.append(label)
            if len(labels) >= 3:
                break

        return "、".join(labels[:3])

    def _ensure_runtime_file(self, file_id: str) -> dict[str, Any]:
        """确保运行态文件记录具备解析后的统一结构。"""

        file_record = self.store.files.get(file_id)
        if not file_record:
            raise AppError("未找到审核所需文件。", status_code=404)

        if "text" in file_record and "detected_type" in file_record:
            return file_record

        raw_bytes = file_record.get("raw_bytes")
        filename = str(file_record.get("filename", "unnamed-file"))
        if isinstance(raw_bytes, (bytes, bytearray)):
            parsed = self.file_parser.parse_file(bytes(raw_bytes), filename, content_type=file_record.get("content_type"), file_id=file_id)
            self.store.files[file_id] = {**file_record, **parsed}
            return self.store.files[file_id]

        fallback_text = str(file_record.get("preview_text", ""))
        file_record.setdefault("text", fallback_text)
        file_record.setdefault("needs_ocr", False)
        file_record.setdefault("page_images", [])
        file_record.setdefault("is_scanned_pdf", False)
        file_record.setdefault("source_kind", "text")
        return file_record

    @staticmethod
    async def _notify_progress(
        callback: Callable[[int, str], Awaitable[None] | None] | None,
        progress: int,
        message: str,
    ) -> None:
        """统一调用进度回调。"""

        if callback is None:
            return
        result = callback(progress, message)
        if asyncio.iscoroutine(result):
            await result

    async def _await_llm_call(
        self,
        call_factory: Callable[[], Awaitable[str]],
        *,
        should_cancel: Callable[[], bool] | None,
    ) -> str:
        """执行一次 LLM 调用，并在调用前后检查取消，同时兜底转换 asyncio 超时错误。"""

        self._ensure_not_cancelled(should_cancel)
        try:
            response = await call_factory()
        except asyncio.TimeoutError as exc:
            raise AppError("模型调用超时，请稍后重试或缩小待审核文件内容。", status_code=504) from exc
        self._ensure_not_cancelled(should_cancel)
        return response

    @staticmethod
    def _ensure_not_cancelled(should_cancel: Callable[[], bool] | None) -> None:
        """在关键阶段检查取消状态。"""

        if should_cancel and should_cancel():
            raise asyncio.CancelledError()

    @staticmethod
    async def _update_task(task: dict[str, object], status: str, progress: int, message: str) -> None:
        """更新任务进度。"""

        task["status"] = status
        task["progress_percent"] = progress
        task["message"] = message
        task["updated_at"] = datetime.now(timezone.utc)

    async def _finalize_cancel(self, task: dict[str, object]) -> None:
        """收敛任务取消状态。"""

        task["status"] = "cancelled"
        task["message"] = "审核任务已取消。"
        task["result"] = AuditResultResponse(
            task_id=str(task["task_id"]),
            status="cancelled",
            summary={"red": 0, "yellow": 0, "blue": 0},
            issues=[],
            message="任务已取消，未生成正式审核结果。",
        )
        task["updated_at"] = datetime.now(timezone.utc)

    def _get_profile(self, user_id: str) -> dict[str, Any]:
        if self.repo is not None:
            profile = self.repo.get_profile(user_id)
            if profile is not None:
                self.store.profiles[user_id] = profile
                return profile

        return self.store.profiles.get(user_id, {})

    def _require_profile_api_key(self, profile: dict[str, Any], provider: str) -> str:
        user_api_key = self._get_profile_api_key(profile, provider)
        if not user_api_key:
            raise AppError("请先在设置页配置当前模型对应的 API Key，才能启动审核。", status_code=400)
        return user_api_key

    def _get_profile_api_key(self, profile: dict[str, Any], provider: str) -> str | None:
        key_field = _PROVIDER_PROFILE_KEY_FIELDS.get(provider)
        if key_field is None:
            return None

        stored_value = profile.get(key_field)
        if not stored_value:
            return None

        user_api_key = self._decrypt_stored_key(str(stored_value)).strip()
        return user_api_key or None

    def _decrypt_stored_key(self, stored_value: str) -> str:
        if not self.cipher.is_configured():
            return stored_value
        try:
            return self.cipher.decrypt(stored_value)
        except EncryptionConfigurationError:
            return stored_value
        except Exception:
            return stored_value

    def _get_task(self, user_id: str, task_id: str) -> dict[str, object]:
        """按用户读取任务。"""

        task = self.store.audit_tasks.get(task_id)
        if not task or task.get("user_id") != user_id:
            raise AppError("未找到指定审核任务。", status_code=404)
        return task

    def _upload_reports_to_storage(
        self,
        task_id: str,
        user_id: str,
        report_bundle: dict[str, Any],
    ) -> dict[str, str]:
        """把报告文件上传到 Supabase Storage，返回路径映射。"""

        if self.repo is None:
            return {}

        paths: dict[str, str] = {}
        content_types = {
            "marked": "application/zip",
            "detailed": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "zip": "application/zip",
        }
        bundle_keys = {
            "marked": "marked_report",
            "detailed": "detailed_report",
            "zip": "report_zip",
        }

        for report_type, bundle_key in bundle_keys.items():
            file_obj = report_bundle.get(bundle_key)
            if file_obj is None:
                continue
            storage_filename = _REPORT_STORAGE_FILENAMES.get(report_type, f"{report_type}.bin")
            storage_path = f"{user_id}/{task_id}/{storage_filename}"
            try:
                file_bytes = file_obj.getvalue() if hasattr(file_obj, "getvalue") else bytes(file_obj)
                success = self.repo.upload_report_file(
                    _AUDIT_REPORT_BUCKET,
                    storage_path,
                    file_bytes,
                    content_types.get(report_type, "application/octet-stream"),
                )
                if success:
                    paths[report_type] = storage_path
                    logger.info("Report %s uploaded to %s/%s", report_type, _AUDIT_REPORT_BUCKET, storage_path)
                else:
                    logger.warning("Report %s upload returned False for task %s", report_type, task_id)
            except Exception:
                logger.warning("Failed to upload report %s for task %s", report_type, task_id, exc_info=True)

        return paths

    @staticmethod
    def _build_report_storage_path(user_id: str, task_id: str, report_type: str) -> str:
        filename = _REPORT_STORAGE_FILENAMES[report_type]
        return f"reports/{user_id}/{task_id}/{filename}"

    @staticmethod
    def _report_bytes_from_object(report_obj: Any) -> bytes | None:
        if isinstance(report_obj, io.BytesIO):
            report_bytes = report_obj.getvalue()
        elif isinstance(report_obj, (bytes, bytearray)):
            report_bytes = bytes(report_obj)
        else:
            return None
        return report_bytes or None

    def _get_memory_report_bytes(self, user_id: str, task_id: str, report_meta: dict[str, str]) -> bytes | None:
        try:
            task = self._get_task(user_id, task_id)
        except AppError:
            return None

        report_bundle = task.get("report_bundle")
        if not isinstance(report_bundle, dict):
            return None

        return self._report_bytes_from_object(report_bundle.get(report_meta["bundle_key"]))

    def _get_task_report_paths(self, user_id: str, task_id: str) -> dict[str, str] | None:
        try:
            task = self._get_task(user_id, task_id)
        except AppError:
            return None

        report_paths = task.get("report_paths")
        if not isinstance(report_paths, dict):
            return None
        return {str(key): str(value) for key, value in report_paths.items() if value}

    def _get_persisted_report_paths(self, user_id: str, task_id: str) -> dict[str, str] | None:
        if self.repo is None:
            return None

        try:
            history_item = self.repo.get_audit_history_by_task_id(user_id, task_id)
        except Exception:
            logger.warning("Audit history lookup by task_id failed during report lookup.", exc_info=True)
            return None

        if not history_item:
            return None

        report_paths = history_item.get("report_paths")
        if not isinstance(report_paths, dict):
            return None
        return {str(key): str(value) for key, value in report_paths.items() if value}

    def _has_persisted_report_bundle(self, user_id: str, task_id: str) -> bool:
        """检查 Supabase Storage / audit_history 中是否有持久化的报告。"""

        if self.repo is None:
            return False
        try:
            history_record = self.repo.get_audit_history_by_task_id(user_id, task_id)
            if not history_record:
                return False
            report_paths = history_record.get("report_paths")
            if not report_paths or not isinstance(report_paths, dict):
                return False
            return bool(report_paths.get("marked") or report_paths.get("detailed") or report_paths.get("zip"))
        except Exception:
            logger.warning("Failed to check persisted report bundle for task %s", task_id, exc_info=True)
            return False

    def _get_storage_report_bytes(self, user_id: str, task_id: str, report_type: str) -> bytes | None:
        if self.repo is None:
            return None

        report_paths = self._get_task_report_paths(user_id, task_id) or self._get_persisted_report_paths(user_id, task_id)
        if report_paths is None:
            return None
        path = report_paths.get(report_type)
        if not path:
            return None

        return self.repo.download_report_file(_AUDIT_REPORT_BUCKET, str(path))

    def get_report_download(
        self,
        current_user: CurrentUser,
        task_id: str,
        report_type: str,
    ) -> tuple[io.BytesIO, str, str]:
        """返回 (file_obj, filename, media_type) 三元组。"""

        spec = _REPORT_DOWNLOADS.get(report_type)
        if spec is None:
            raise AppError("不支持的报告类型。", status_code=400)

        bundle_key = spec["bundle_key"]
        filename = self._build_download_filename(report_type, spec, task_id, None)
        media_type = spec["media_type"]

        task = self.store.audit_tasks.get(task_id)
        if task and task.get("user_id") == current_user.id:
            filename = self._build_download_filename(report_type, spec, task_id, task)
        if task and task.get("user_id") == current_user.id:
            bundle = task.get("report_bundle")
            if bundle and bundle.get(bundle_key):
                file_obj = bundle[bundle_key]
                if hasattr(file_obj, "seek"):
                    file_obj.seek(0)
                if report_type == "marked":
                    report_bytes = self._report_bytes_from_object(file_obj)
                    if not self._is_marked_only_zip(report_bytes):
                        self._raise_marked_download_unavailable("LEGACY_TASK_NO_MARKED_WORKBOOK")
                    if hasattr(file_obj, "seek"):
                        file_obj.seek(0)
                return file_obj, filename, media_type
            if report_type == "marked" and bundle:
                self._raise_marked_download_unavailable(self._marked_report_reason_code_for_task(task))

        report_paths = None
        found_history_record = False
        if task and task.get("user_id") == current_user.id and task.get("report_paths"):
            report_paths = task["report_paths"]
        elif self.repo is not None:
            history_record = self.repo.get_audit_history_by_task_id(current_user.id, task_id)
            if history_record:
                found_history_record = True
                report_paths = history_record.get("report_paths")

        if report_paths and self.repo is not None:
            storage_path = report_paths.get(report_type)
            if storage_path:
                file_bytes = self.repo.download_report_file(_AUDIT_REPORT_BUCKET, storage_path)
                if file_bytes:
                    if report_type == "marked":
                        if self._is_marked_only_zip(file_bytes):
                            return io.BytesIO(file_bytes), filename, media_type
                        if self._is_marked_workbook_path(str(storage_path)):
                            return self._build_single_marked_workbook_zip(file_bytes, str(storage_path)), filename, media_type
                        self._raise_marked_download_unavailable("LEGACY_TASK_NO_MARKED_WORKBOOK")
                    return io.BytesIO(file_bytes), filename, media_type
            if report_type == "marked":
                self._raise_marked_download_unavailable("LEGACY_TASK_NO_MARKED_WORKBOOK")

        if report_type == "marked":
            if task and task.get("user_id") == current_user.id:
                self._raise_marked_download_unavailable(self._marked_report_reason_code_for_task(task))
            if found_history_record:
                self._raise_marked_download_unavailable("LEGACY_TASK_NO_MARKED_WORKBOOK")

        raise AppError("报告文件暂不可用，可能已过期或尚未生成。请重新运行审核。", status_code=404)

    @staticmethod
    def _is_marked_only_zip(report_bytes: bytes | None) -> bool:
        if not report_bytes:
            return False
        try:
            with zipfile.ZipFile(io.BytesIO(report_bytes)) as zf:
                names = zf.namelist()
        except zipfile.BadZipFile:
            return False
        return bool(names) and all(
            name.startswith("标记版/审核标记版-") and name.endswith(".xlsx") and not name.endswith("/")
            for name in names
        )

    @staticmethod
    def _is_marked_workbook_path(storage_path: str) -> bool:
        filename = Path(storage_path).name
        return filename.startswith("审核标记版-") and filename.endswith(".xlsx")

    @staticmethod
    def _build_single_marked_workbook_zip(file_bytes: bytes, storage_path: str) -> io.BytesIO:
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr(f"标记版/{Path(storage_path).name}", file_bytes)
        archive.seek(0)
        return archive

    @staticmethod
    def _raise_marked_download_unavailable(reason_code: str) -> None:
        message = _MARKED_DOWNLOAD_MESSAGES.get(reason_code) or _MARKED_DOWNLOAD_MESSAGES["MARKED_REPORT_UNAVAILABLE"]
        raise AppError(message, status_code=409, reason_code=reason_code)

    def _marked_report_reason_code_for_task(self, task: dict[str, Any]) -> str:
        target_extensions: list[str] = []
        for item in task.get("target_files", []):
            if not isinstance(item, dict):
                continue
            file_id = str(item.get("file_id") or item.get("id") or "")
            record = self.store.files.get(file_id, {}) if file_id else {}
            extension = self._file_extension({**record, **item})
            if extension:
                target_extensions.append(extension)
        if any(extension == "xlsx" for extension in target_extensions):
            return "NO_MARKED_WORKBOOK"
        if target_extensions and all(extension != "xlsx" for extension in target_extensions):
            return "ONLY_UNSUPPORTED_FILES"

        original_xlsx_paths = task.get("original_xlsx_paths")
        if isinstance(original_xlsx_paths, dict) and any(str(path or "").strip() for path in original_xlsx_paths.values()):
            return "NO_MARKED_WORKBOOK"
        if task.get("status") == "completed":
            return "NO_MARKABLE_XLSX"
        return "MARKED_REPORT_UNAVAILABLE"

    @staticmethod
    def _file_extension(file_record: dict[str, Any]) -> str:
        extension = str(file_record.get("extension") or "").strip().lower().lstrip(".")
        if extension:
            return extension
        filename = str(file_record.get("filename") or file_record.get("name") or "")
        return Path(filename).suffix.lower().lstrip(".")

    @staticmethod
    def _build_download_filename(
        report_type: str,
        report_spec: dict[str, str],
        task_id: str,
        task: dict[str, Any] | None,
    ) -> str:
        if isinstance(task, dict):
            bundle = task.get("report_bundle")
            if isinstance(bundle, dict):
                filenames = bundle.get("filenames")
                if isinstance(filenames, dict) and str(filenames.get(report_type) or "").strip():
                    return str(filenames[report_type])

        identifier = pick_report_identifier(task or {}, task_id)
        return build_report_filename(str(report_spec["kind"]), identifier, str(report_spec["ext"]))

    @staticmethod
    def _normalize_affiliate_text(value: str) -> str:
        """归一化公司名或主体文本。"""

        text = (value or "").lower()
        for token in (" ", ",", ".", "-", "_", "(", ")", "limited", "ltd", "co", "company"):
            text = text.replace(token, "")
        return text

    @staticmethod
    def _recount_summary(issues: list[dict[str, Any]]) -> dict[str, int]:
        """按 issue 重新统计 summary。"""

        summary = {"red": 0, "yellow": 0, "blue": 0}
        for issue in issues:
            level = str(issue.get("level", "")).upper()
            if level == "RED":
                summary["red"] += 1
            elif level == "BLUE":
                summary["blue"] += 1
            else:
                if level not in ("RED", "YELLOW", "BLUE"):
                    logger.warning("Unexpected issue level '%s' in recount, treating as YELLOW.", level)
                summary["yellow"] += 1
        return summary
