"""Provide a minimal audit task lifecycle for the current round."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from uuid import uuid4

from app.config import Settings
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
from app.services.token_utils import TokenUtilityService


class AuditOrchestratorService:
    """Coordinate minimal audit task startup, progress, cancel, and result flow."""

    def __init__(
        self,
        settings: Settings,
        file_parser: FileParserService,
        llm_client: LLMClientService,
        report_generator: ReportGeneratorService,
        token_utils: TokenUtilityService,
        store: RuntimeStore,
    ) -> None:
        self.settings = settings
        self.file_parser = file_parser
        self.llm_client = llm_client
        self.report_generator = report_generator
        self.token_utils = token_utils
        self.store = store
        self.audit_engine = AuditEngineService()

    def get_capability(self) -> AuditCapability:
        return AuditCapability(
            mode="minimal-task-lifecycle",
            features=[
                FeatureStatus(
                    name="审核任务主链路",
                    ready=True,
                    note="已提供任务创建、进度、取消和结果读取的最小闭环。",
                ),
                FeatureStatus(
                    name="真实审核引擎",
                    ready=False,
                    note="本轮不实现完整 OCR、字段比对和规则推理。",
                ),
                *self.audit_engine.get_features(),
                *self.report_generator.get_features(),
                *self.token_utils.get_features(),
            ],
        )

    def start_audit(
        self,
        current_user: CurrentUser,
        payload: AuditStartRequest,
    ) -> AuditStartResponse:
        """Start a minimal audit task with the original request contract."""

        self.file_parser.get_user_file(current_user.id, payload.po_file_id)

        for item in payload.target_files:
            self.file_parser.get_user_file(current_user.id, item.file_id)
        for item in payload.prev_ticket_files:
            self.file_parser.get_user_file(current_user.id, item.file_id)
        if payload.template_file_id:
            self.file_parser.get_user_file(current_user.id, payload.template_file_id)
        for file_id in payload.reference_file_ids:
            self.file_parser.get_user_file(current_user.id, file_id)

        profile = self.store.profiles.get(current_user.id, {})
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
            "reference_file_ids": list(payload.reference_file_ids),
            "custom_rules": list(profile.get("active_custom_rules", [])),
            "deep_think": payload.deep_think,
            "cancel_requested": False,
            "created_at": now,
            "updated_at": now,
            "result": None,
        }

        asyncio.create_task(self._run_task(task_id))
        return AuditStartResponse(
            task_id=task_id,
            status="queued",
            message="审核任务已创建，等待处理。",
        )

    async def progress_stream(self, current_user: CurrentUser, task_id: str):
        """Yield audit progress as SSE events."""

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
        """Cancel a pending or running task."""

        task = self._get_task(current_user.id, task_id)
        if task["status"] in {"completed", "cancelled", "failed"}:
            return AuditCancelResponse(
                task_id=task_id,
                status=str(task["status"]),
                message="该任务已经结束，无需重复取消。",
            )

        task["cancel_requested"] = True
        task["status"] = "cancelling"
        task["message"] = "已收到取消请求，正在停止任务。"
        task["updated_at"] = datetime.now(timezone.utc)
        return AuditCancelResponse(
            task_id=task_id,
            status="cancelling",
            message="已收到取消请求，正在停止任务。",
        )

    def get_result(self, current_user: CurrentUser, task_id: str) -> AuditResultResponse:
        """Return the current audit result or an unfinished placeholder."""

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
        """Return a placeholder for the future report endpoint."""

        self._get_task(current_user.id, task_id)
        return AuditReportResponse(
            task_id=task_id,
            message="本轮暂未开放报告下载，请先查看任务结果。",
        )

    def get_history(self, current_user: CurrentUser) -> AuditHistoryListResponse:
        """Return minimal in-memory audit history."""

        items = [
            AuditHistoryItem(
                id=str(item["id"]),
                model_used=str(item["model_used"]),
                document_count=int(item["document_count"]),
                red_count=int(item["red_count"]),
                yellow_count=int(item["yellow_count"]),
                blue_count=int(item["blue_count"]),
                deep_think_used=bool(item["deep_think_used"]),
                created_at=item.get("created_at"),
            )
            for item in self.store.audit_history.get(current_user.id, [])
        ]
        return AuditHistoryListResponse(items=items)

    def get_history_detail(self, current_user: CurrentUser, history_id: str) -> AuditHistoryDetailResponse:
        """Return one in-memory history record."""

        for item in self.store.audit_history.get(current_user.id, []):
            if str(item["id"]) == history_id:
                return AuditHistoryDetailResponse(item=item)
        raise AppError("未找到指定审核历史记录。", status_code=404)

    async def _run_task(self, task_id: str) -> None:
        task = self.store.audit_tasks[task_id]
        try:
            await self._update_task(task, "running", 15, "正在读取基准文件。")
            await asyncio.sleep(0.2)
            if task["cancel_requested"]:
                await self._finalize_cancel(task)
                return

            await self._update_task(task, "running", 55, "正在生成最小审核结果。")
            await asyncio.sleep(0.2)
            if task["cancel_requested"]:
                await self._finalize_cancel(task)
                return

            issues = [
                AuditIssue(
                    level="BLUE",
                    field_name="status",
                    message="当前结果为第 4 轮任务生命周期占位结果，后续轮次会替换为真实审核问题列表。",
                )
            ]
            result = AuditResultResponse(
                task_id=task_id,
                status="completed",
                summary={"red": 0, "yellow": 0, "blue": len(issues)},
                issues=issues,
                message="审核任务已完成，当前结果为最小占位结构。",
            )
            task["result"] = result
            task["status"] = "completed"
            task["progress_percent"] = 100
            task["message"] = "审核任务已完成。"
            task["updated_at"] = datetime.now(timezone.utc)

            history_item = {
                "id": str(uuid4()),
                "user_id": task["user_id"],
                "document_count": len(task["target_files"]) + 1,
                "red_count": 0,
                "yellow_count": 0,
                "blue_count": len(issues),
                "audit_result": result.model_dump(mode="json"),
                "model_used": self.settings.default_text_model,
                "custom_rules_snapshot": list(task["custom_rules"]),
                "deep_think_used": bool(task["deep_think"]),
                "created_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
            }
            self.store.audit_history.setdefault(task["user_id"], []).insert(0, history_item)
        except Exception as exc:  # pragma: no cover
            task["status"] = "failed"
            task["message"] = f"审核任务执行失败：{exc}"
            task["updated_at"] = datetime.now(timezone.utc)

    @staticmethod
    async def _update_task(task: dict[str, object], status: str, progress: int, message: str) -> None:
        task["status"] = status
        task["progress_percent"] = progress
        task["message"] = message
        task["updated_at"] = datetime.now(timezone.utc)

    async def _finalize_cancel(self, task: dict[str, object]) -> None:
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

    def _get_task(self, user_id: str, task_id: str) -> dict[str, object]:
        task = self.store.audit_tasks.get(task_id)
        if not task or task.get("user_id") != user_id:
            raise AppError("未找到指定审核任务。", status_code=404)
        return task
