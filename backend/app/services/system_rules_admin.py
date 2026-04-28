"""Admin service for DB-backed system hard rules.

This service intentionally does not feed rules into the audit flow. It only
serves the management/read-only HTTP APIs for ``system_hard_rules``.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from app.db.repository import SupabaseRepository
from app.errors import AppError
from app.models.schemas import (
    AdminSystemRuleResponse,
    CurrentUser,
    PublicSystemRuleResponse,
    SystemRuleChangeLogResponse,
    SystemRuleCreateRequest,
    SystemRuleUpdateRequest,
)

RULE_SNAPSHOT_FIELDS = ("code", "title", "content", "is_enabled", "sort_order")
UPDATE_FIELDS = ("title", "content", "is_enabled", "sort_order")
LAST_ENABLED_RULE_MESSAGE = "至少需要保留一条启用的系统硬约束规则。"
logger = logging.getLogger(__name__)


class SystemRulesAdminService:
    """Coordinate validation, rule writes, and audit logs for system hard rules."""

    def __init__(self, repo: SupabaseRepository | None) -> None:
        self.repo = repo

    def list_admin_system_rules(self) -> list[AdminSystemRuleResponse]:
        repo = self._require_repo()
        return [self._to_admin_rule_response(row) for row in repo.list_system_hard_rules()]

    def list_active_system_rules(self) -> list[PublicSystemRuleResponse]:
        repo = self._require_repo()
        return [self._to_public_rule_response(row) for row in repo.list_system_hard_rules(enabled_only=True)]

    def create_system_rule(
        self,
        current_user: CurrentUser,
        payload: SystemRuleCreateRequest,
    ) -> AdminSystemRuleResponse:
        repo = self._require_repo()
        reason = self._require_non_empty_text(payload.reason, "reason")
        title = self._require_non_empty_text(payload.title, "title")
        content = self._require_non_empty_text(payload.content, "content")
        sort_order = self._validate_optional_int(payload.sort_order, "sort_order")
        is_enabled = self._validate_optional_bool(payload.is_enabled, "is_enabled", default=True)
        if sort_order is None:
            sort_order = repo.get_max_system_hard_rule_sort_order() + 10

        code = self._generate_unique_code(title)
        created = repo.create_system_hard_rule(
            {
                "code": code,
                "title": title,
                "content": content,
                "sort_order": sort_order,
                "is_enabled": is_enabled,
                "created_by": current_user.id,
                "updated_by": current_user.id,
            }
        )

        repo.create_system_rule_change_log(
            {
                "rule_id": created["id"],
                "rule_code_snapshot": created["code"],
                "action": "create",
                "old_value": None,
                "new_value": self._snapshot(created),
                "reason": reason,
                "summary": f"新增系统硬约束规则：{created['title']}",
                "changed_by": current_user.id,
            }
        )
        return self._to_admin_rule_response(created)

    def update_system_rule(
        self,
        current_user: CurrentUser,
        rule_id: str,
        payload: SystemRuleUpdateRequest,
    ) -> AdminSystemRuleResponse:
        repo = self._require_repo()
        reason = self._require_non_empty_text(payload.reason, "reason")
        existing = repo.get_system_hard_rule(rule_id)
        if existing is None:
            raise AppError("未找到指定系统硬约束规则。", status_code=404)

        requested = payload.model_dump(exclude_unset=True)
        requested.pop("reason", None)
        updates: dict[str, Any] = {}
        for field_name in UPDATE_FIELDS:
            if field_name not in requested:
                continue
            value = requested[field_name]
            if field_name in ("title", "content"):
                value = self._require_non_empty_text(value, field_name)
            elif field_name == "sort_order":
                value = self._require_int(value, field_name)
            elif field_name == "is_enabled":
                value = self._require_bool(value, field_name)
            if value != existing.get(field_name):
                updates[field_name] = value

        if not updates:
            raise AppError("请至少提供一个实际需要更新的字段。", status_code=400)

        if (
            existing.get("is_enabled") is True
            and updates.get("is_enabled") is False
            and repo.count_enabled_system_hard_rules() <= 1
        ):
            raise AppError(LAST_ENABLED_RULE_MESSAGE, status_code=400)

        old_value = self._snapshot(existing)
        updated = repo.update_system_hard_rule(
            rule_id,
            {
                **updates,
                "updated_by": current_user.id,
            },
        )
        new_value = self._snapshot(updated)
        action = self._choose_action(updates)
        repo.create_system_rule_change_log(
            {
                "rule_id": updated["id"],
                "rule_code_snapshot": updated["code"],
                "action": action,
                "old_value": old_value,
                "new_value": new_value,
                "reason": reason,
                "summary": self._build_update_summary(action, updated),
                "changed_by": current_user.id,
            }
        )
        return self._to_admin_rule_response(updated)

    def list_change_logs(
        self,
        *,
        limit: int = 50,
        rule_id: str | None = None,
    ) -> list[SystemRuleChangeLogResponse]:
        repo = self._require_repo()
        safe_limit = max(1, min(int(limit), 200))
        rows = repo.list_system_rule_change_logs(limit=safe_limit, rule_id=rule_id)
        email_by_user_id: dict[str, str] = {}
        try:
            email_by_user_id = repo.list_user_emails_by_ids(
                [str(row["changed_by"]) for row in rows if row.get("changed_by")]
            )
        except Exception:
            logger.warning("Failed to enrich system rule change log actors.", exc_info=True)
        return [
            self._to_change_log_response(
                row,
                changed_by_email=email_by_user_id.get(str(row.get("changed_by"))),
            )
            for row in rows
        ]

    def _generate_unique_code(self, title: str) -> str:
        repo = self._require_repo()
        base = self._slugify(title) or "system_hard_rule"
        code = base
        suffix = 2
        while repo.get_system_hard_rule_by_code(code) is not None:
            code = f"{base}_{suffix}"
            suffix += 1
        return code

    @staticmethod
    def _slugify(value: str) -> str:
        normalized = value.strip().lower()
        normalized = re.sub(r"[^a-z0-9]+", "_", normalized)
        normalized = re.sub(r"_+", "_", normalized).strip("_")
        return normalized[:48].strip("_")

    @staticmethod
    def _require_non_empty_text(value: Any, field_name: str) -> str:
        if not isinstance(value, str):
            raise AppError(f"{field_name} 必须是字符串。", status_code=400)
        stripped = value.strip()
        if not stripped:
            raise AppError(f"{field_name} 不能为空。", status_code=400)
        return stripped

    def _validate_optional_int(self, value: Any, field_name: str) -> int | None:
        if value is None:
            return None
        return self._require_int(value, field_name)

    @staticmethod
    def _require_int(value: Any, field_name: str) -> int:
        if isinstance(value, bool) or not isinstance(value, int):
            raise AppError(f"{field_name} 必须是整数。", status_code=400)
        return value

    def _validate_optional_bool(self, value: Any, field_name: str, *, default: bool) -> bool:
        if value is None:
            return default
        return self._require_bool(value, field_name)

    @staticmethod
    def _require_bool(value: Any, field_name: str) -> bool:
        if not isinstance(value, bool):
            raise AppError(f"{field_name} 必须是布尔值。", status_code=400)
        return value

    @staticmethod
    def _choose_action(updates: dict[str, Any]) -> str:
        if set(updates) == {"sort_order"}:
            return "reorder"
        if updates.get("is_enabled") is False:
            return "disable"
        if updates.get("is_enabled") is True:
            return "enable"
        return "update"

    @staticmethod
    def _build_update_summary(action: str, rule: dict[str, Any]) -> str:
        title = str(rule.get("title", ""))
        if action == "reorder":
            return f"调整系统硬约束规则排序：{title}"
        if action == "disable":
            return f"停用系统硬约束规则：{title}"
        if action == "enable":
            return f"启用系统硬约束规则：{title}"
        return f"更新系统硬约束规则：{title}"

    @staticmethod
    def _snapshot(rule: dict[str, Any]) -> dict[str, Any]:
        return {field_name: rule.get(field_name) for field_name in RULE_SNAPSHOT_FIELDS}

    def _require_repo(self) -> SupabaseRepository:
        if self.repo is None:
            raise AppError("Supabase is not configured.", status_code=500)
        return self.repo

    @staticmethod
    def _to_admin_rule_response(row: dict[str, Any]) -> AdminSystemRuleResponse:
        return AdminSystemRuleResponse(
            id=str(row["id"]),
            code=str(row["code"]),
            title=str(row["title"]),
            content=str(row["content"]),
            is_enabled=bool(row.get("is_enabled", False)),
            sort_order=int(row.get("sort_order", 0)),
            created_at=row.get("created_at"),
            updated_at=row.get("updated_at"),
            created_by=str(row["created_by"]) if row.get("created_by") else None,
            updated_by=str(row["updated_by"]) if row.get("updated_by") else None,
        )

    @staticmethod
    def _to_public_rule_response(row: dict[str, Any]) -> PublicSystemRuleResponse:
        return PublicSystemRuleResponse(
            id=str(row["id"]),
            code=str(row["code"]),
            title=str(row["title"]),
            content=str(row["content"]),
            sort_order=int(row.get("sort_order", 0)),
        )

    @staticmethod
    def _to_change_log_response(
        row: dict[str, Any],
        *,
        changed_by_email: str | None = None,
    ) -> SystemRuleChangeLogResponse:
        return SystemRuleChangeLogResponse(
            id=str(row["id"]),
            rule_id=str(row["rule_id"]) if row.get("rule_id") else None,
            rule_code_snapshot=str(row["rule_code_snapshot"]),
            action=row["action"],
            old_value=row.get("old_value"),
            new_value=row.get("new_value"),
            reason=str(row["reason"]),
            summary=row.get("summary"),
            changed_by=str(row["changed_by"]),
            changed_by_email=changed_by_email,
            changed_at=row.get("changed_at"),
        )
