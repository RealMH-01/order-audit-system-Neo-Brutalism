"""审核任务调度器：连接文件解析、Prompt 构造、模型调用、结果修正和报告输出。"""

from __future__ import annotations

import asyncio
import io
import json
import logging
from datetime import datetime, timedelta, timezone
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
from app.services.audit_engine import AuditEngineService
from app.services.file_parser import FileParserService
from app.services.llm_client import LLMClientService
from app.services.report_generator import ReportGeneratorService
from app.services.runtime_store import RuntimeStore
from app.services.template_library import TemplateLibraryService
from app.services.token_utils import TokenUtilityService

logger = logging.getLogger(__name__)

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


_REPORT_DOWNLOADS = {
    "marked": {
        "bundle_key": "marked_report",
        "filename": "audit_marked_{task_id}.xlsx",
        "media_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    "detailed": {
        "bundle_key": "detailed_report",
        "filename": "audit_detailed_{task_id}.xlsx",
        "media_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    "zip": {
        "bundle_key": "report_zip",
        "filename": "audit_reports_{task_id}.zip",
        "media_type": "application/zip",
    },
}

_AUDIT_REPORT_BUCKET = "audit-reports"
_REPORT_STORAGE_FILENAMES = {
    "marked": "marked.xlsx",
    "detailed": "detailed.xlsx",
    "zip": "reports.zip",
}


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
        custom_rules = list(profile.get("active_custom_rules", []))
        resolved_rules = self.template_library.resolve_audit_rules_for_run(
            current_user=current_user,
            template_id=payload.template_id,
            temporary_rules=custom_rules,
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
            "custom_rules": custom_rules,
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

        await self._notify_progress(progress_callback, 80, "正在汇总审核结果并生成报告。")
        aggregate_result = self._aggregate_results(first_round_results)
        report_bundle = self.report_generator.generate_report_bundle(task_id, aggregate_result)

        return {
            "aggregate_result": aggregate_result,
            "document_results": first_round_results,
            "report_bundle": report_bundle,
            "provider": primary_provider,
        }

    async def progress_stream(self, current_user: CurrentUser, task_id: str):
        """以 SSE 输出任务进度。"""

        while True:
            task = self._get_task(current_user.id, task_id)
            payload = AuditProgressPayload(
                task_id=task_id,
                status=str(task["status"]),
                progress_percent=int(task["progress_percent"]),
                message=str(task["message"]),
                created_at=task["created_at"],
                updated_at=task["updated_at"],
            )
            yield f"data: {json.dumps(payload.model_dump(mode='json'), ensure_ascii=False)}\n\n"
            if task["status"] in {"completed", "cancelled", "failed"}:
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
            return AuditResultResponse(
                task_id=task_id,
                status=str(task["status"]),
                summary={"red": 0, "yellow": 0, "blue": 0},
                issues=[],
                message="任务尚未产出最终结果。",
            )
        return task["result"]

    def get_report_placeholder(self, current_user: CurrentUser, task_id: str) -> AuditReportResponse:
        """返回报告状态说明。"""

        try:
            task = self._get_task(current_user.id, task_id)
        except AppError as exc:
            if exc.status_code != 404 or not self._has_persisted_report_bundle(current_user.id, task_id):
                raise
            return AuditReportResponse(
                task_id=task_id,
                message="报告已生成，可下载标记版 Excel、详情版 Excel 和 ZIP。",
                status="ready",
                available=True,
                downloads=["marked", "detailed", "zip"],
            )

        if task.get("report_bundle") or self._has_persisted_report_bundle(current_user.id, task_id):
            return AuditReportResponse(
                task_id=task_id,
                message="报告已生成，可下载标记版 Excel、详情版 Excel 和 ZIP。",
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
            str(po_record.get("text", "")),
            model_for_call,
            document_token_budget,
        )
        target_text_context, target_truncated = self._prepare_text_context(
            str(target_record.get("text", "")),
            model_for_call,
            document_token_budget,
        )
        prev_text_context, _ = self._prepare_text_context(prev_text, model_for_call, document_token_budget)
        template_text_context, _ = self._prepare_text_context(template_text, model_for_call, document_token_budget)
        reference_text_contexts = [
            self._prepare_text_context(text, model_for_call, document_token_budget)[0]
            for text in reference_texts
        ]

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
        parsed_result = self._post_process_force_downgrade(parsed_result, company_affiliates)

        if custom_rules:
            self._ensure_not_cancelled(should_cancel)
            custom_messages = self.audit_engine.build_custom_rules_review_prompt(
                original_result=parsed_result,
                custom_rules=custom_rules,
                po_text=po_text_context,
                target_text=target_text_context,
                target_type=doc_type,
            )
            custom_response = await self._await_llm_call(
                lambda: self.llm_client.call_llm(
                    custom_messages,
                    provider=provider_for_call,
                    requested_model=model_for_call,
                    api_key=user_api_key,
                    deep_think=deep_think,
                    timeout=self._LLM_SINGLE_CALL_TIMEOUT_SECONDS,
                ),
                should_cancel=should_cancel,
            )
            parsed_result = self._post_process_force_downgrade(
                self.audit_engine.parse_audit_result(custom_response),
                company_affiliates,
            )

        if prev_text or template_text or reference_texts:
            self._ensure_not_cancelled(should_cancel)
            cross_check_messages = self.audit_engine.build_cross_check_prompt(
                po_text=po_text_context,
                target_text=target_text_context,
                current_result=parsed_result,
                prev_ticket_text=prev_text_context,
                template_text=template_text_context,
                reference_texts=reference_text_contexts,
                target_type=doc_type,
            )
            cross_response = await self._await_llm_call(
                lambda: self.llm_client.call_llm(
                    cross_check_messages,
                    provider=provider_for_call,
                    requested_model=model_for_call,
                    api_key=user_api_key,
                    deep_think=False,
                    timeout=self._LLM_SINGLE_CALL_TIMEOUT_SECONDS,
                ),
                should_cancel=should_cancel,
            )
            parsed_result = self._post_process_force_downgrade(
                self.audit_engine.parse_audit_result(cross_response),
                company_affiliates,
            )

        if po_truncated or target_truncated:
            self._append_truncation_notice(parsed_result, doc_type, index)

        enriched = self._attach_document_context(parsed_result, target_item, target_record, doc_type, index)
        return {
            "file_id": target_item["file_id"],
            "doc_type": doc_type,
            "provider": provider_for_call,
            "result": enriched,
        }

    def _resolve_doc_type(self, manual_type: str | None, file_record: dict[str, Any]) -> str:
        """手动类型优先，其次依据已解析出的 detected_type 和文件名提示。"""

        if manual_type:
            return manual_type.strip().lower()

        detected_type = str(file_record.get("detected_type", "")).strip().lower()
        if detected_type in _DOC_TYPE_HINTS:
            return detected_type

        filename = str(file_record.get("filename", "")).lower()
        for doc_type, hints in _DOC_TYPE_HINTS.items():
            if any(hint in filename for hint in hints):
                return doc_type

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

    def _prepare_text_context(self, text: str, model: str, max_tokens: int) -> tuple[str, bool]:
        """根据 token 安全上限控制输入文本大小。"""

        token_budget = max(512, max_tokens)
        normalized_text = text or ""
        was_truncated = self.token_utils.estimate_tokens(normalized_text, model) > token_budget
        truncated_text = self.token_utils.truncate_text(normalized_text, max_tokens=token_budget, model=model)
        return truncated_text, was_truncated

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
            task["result"] = self._to_api_result(task_id, aggregate_result)
            task["status"] = "completed"
            task["progress_percent"] = 100
            task["message"] = "审核任务已完成。"
            task["updated_at"] = datetime.now(timezone.utc)
            report_paths = self._upload_report_bundle(user_id, task_id, report_bundle)
            task["report_paths"] = report_paths
            if report_paths is not None:
                task["report_bundle"] = None

            history_item = {
                "id": str(uuid4()),
                "user_id": user_id,
                "task_id": task_id,
                "report_paths": report_paths,
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
            task["message"] = exc.message
            task["updated_at"] = datetime.now(timezone.utc)
        except Exception as exc:  # pragma: no cover
            task["status"] = "failed"
            task["message"] = f"审核任务执行失败：{exc}"
            task["updated_at"] = datetime.now(timezone.utc)

    def _to_api_result(self, task_id: str, aggregate_result: dict[str, Any]) -> AuditResultResponse:
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

    def _upload_report_bundle(
        self,
        user_id: str,
        task_id: str,
        report_bundle: dict[str, Any] | None,
    ) -> dict[str, str] | None:
        if self.repo is None or not isinstance(report_bundle, dict):
            return None

        report_paths: dict[str, str] = {}
        for report_type, report_meta in _REPORT_DOWNLOADS.items():
            report_obj = report_bundle.get(str(report_meta["bundle_key"]))
            report_bytes = self._report_bytes_from_object(report_obj)
            if not report_bytes:
                logger.warning("Report bundle is missing %s for task %s; skipping Storage persistence.", report_type, task_id)
                return None

            path = self._build_report_storage_path(user_id, task_id, report_type)
            uploaded = self.repo.upload_report_file(
                _AUDIT_REPORT_BUCKET,
                path,
                report_bytes,
                str(report_meta["media_type"]),
            )
            if not uploaded:
                logger.warning("Report upload did not complete for task %s type %s; keeping memory fallback.", task_id, report_type)
                return None
            report_paths[report_type] = path

        return report_paths

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
        report_paths = self._get_task_report_paths(user_id, task_id) or self._get_persisted_report_paths(user_id, task_id)
        return bool(report_paths) and all(report_type in report_paths for report_type in _REPORT_DOWNLOADS)

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
        """优先从内存 report_bundle 读取报告，必要时回退到 Supabase Storage。"""

        report_meta = _REPORT_DOWNLOADS.get(report_type)
        if report_meta is None:
            raise AppError("不支持的报告类型。", status_code=400)

        report_bytes = self._get_memory_report_bytes(current_user.id, task_id, report_meta)
        if report_bytes is None:
            report_bytes = self._get_storage_report_bytes(current_user.id, task_id, report_type)

        if not report_bytes:
            raise AppError("报告尚未生成或已失效。", status_code=404)

        return (
            io.BytesIO(report_bytes),
            str(report_meta["filename"]).format(task_id=task_id),
            str(report_meta["media_type"]),
        )

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
