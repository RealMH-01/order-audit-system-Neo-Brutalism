"""Supabase-backed CRUD helpers for persisted runtime tables."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any
from uuid import uuid4

from fastapi.encoders import jsonable_encoder

from app.db.supabase_client import (
    ApiKeyCipher,
    get_api_key_cipher,
    get_supabase_client,
    is_supabase_configured,
)
from app.errors import AppError

logger = logging.getLogger(__name__)

API_KEY_FIELDS = (
    "deepseek_api_key",
    "zhipu_api_key",
    "zhipu_ocr_api_key",
    "openai_api_key",
)
DEFAULT_SYSTEM_RULE_KEY = "default"


class SupabaseRepository:
    """Encapsulate CRUD operations for Supabase-managed tables only."""

    def __init__(
        self,
        client: Any | None = None,
        cipher: ApiKeyCipher | None = None,
    ) -> None:
        self.client = client or get_supabase_client()
        self.cipher = cipher or get_api_key_cipher()
        if self.client is None:
            raise AppError("Supabase is not configured.", status_code=500)

    def get_profile(self, user_id: str) -> dict[str, Any] | None:
        profile = self._select_one(
            "profiles",
            "read profile",
            lambda table: table.select("*").eq("id", user_id).limit(1),
        )
        return self._hydrate_profile(profile) if profile else None

    def upsert_profile(self, user_id: str, data: dict[str, Any]) -> dict[str, Any]:
        payload = self._prepare_profile_payload({"id": user_id, **data})
        self._execute(
            "upsert profile",
            lambda: self.client.table("profiles").upsert(payload, on_conflict="id").execute(),
        )
        profile = self.get_profile(user_id)
        if profile is None:
            raise AppError("Profile upsert succeeded but no record was returned.", status_code=500)
        return profile

    def update_profile(self, user_id: str, data: dict[str, Any]) -> dict[str, Any]:
        if self.get_profile(user_id) is None:
            raise AppError("Profile not found.", status_code=404)

        payload = self._prepare_profile_payload(
            data,
            exclude_fields={"id", "created_at"},
        )
        if payload:
            self._execute(
                "update profile",
                lambda: self.client.table("profiles").update(payload).eq("id", user_id).execute(),
            )

        profile = self.get_profile(user_id)
        if profile is None:
            raise AppError("Profile update succeeded but no record was returned.", status_code=500)
        return profile

    def mark_wizard_completed(self, user_id: str, custom_rules: list[str]) -> dict[str, Any]:
        _ = custom_rules
        return self.update_profile(
            user_id,
            {
                "wizard_completed": True,
                "updated_at": datetime.now(timezone.utc),
            },
        )

    def set_disclaimer_accepted(self, user_id: str, accepted: bool) -> dict[str, Any]:
        return self.update_profile(
            user_id,
            {
                "disclaimer_accepted": accepted,
                "updated_at": datetime.now(timezone.utc),
            },
        )

    def get_system_rules(self) -> dict[str, Any] | None:
        return self.get_system_rule_by_key(DEFAULT_SYSTEM_RULE_KEY)

    def upsert_system_rules(self, data: dict[str, Any]) -> dict[str, Any]:
        payload = self._encode(data)
        payload.setdefault("key", DEFAULT_SYSTEM_RULE_KEY)
        self._execute(
            "upsert system rules",
            lambda: self.client.table("system_rules").upsert(payload, on_conflict="key").execute(),
        )
        rule = self.get_system_rule_by_key(str(payload["key"]))
        if rule is None:
            raise AppError("System rules upsert succeeded but no record was returned.", status_code=500)
        return rule

    def update_system_rules(self, data: dict[str, Any]) -> dict[str, Any]:
        key = str(data.get("key") or DEFAULT_SYSTEM_RULE_KEY)
        if self.get_system_rule_by_key(key) is None:
            raise AppError("System rules not found.", status_code=404)

        payload = self._encode(data, exclude_fields={"id", "created_at"})
        if payload:
            self._execute(
                "update system rules",
                lambda: self.client.table("system_rules").update(payload).eq("key", key).execute(),
            )

        rule = self.get_system_rule_by_key(key)
        if rule is None:
            raise AppError("System rules update succeeded but no record was returned.", status_code=500)
        return rule

    def get_system_rule_by_key(self, key: str) -> dict[str, Any] | None:
        return self._select_one(
            "system_rules",
            "read system rules",
            lambda table: table.select("*").eq("key", key).limit(1),
        )

    def upsert_system_rule(self, data: dict[str, Any]) -> dict[str, Any]:
        return self.upsert_system_rules(data)

    def update_system_rule(self, data: dict[str, Any]) -> dict[str, Any]:
        return self.update_system_rules(data)

    def list_system_hard_rules(self, *, enabled_only: bool = False) -> list[dict[str, Any]]:
        def build_query(table: Any) -> Any:
            query = table.select("*")
            if enabled_only:
                query = query.eq("is_enabled", True)
            return query.order("sort_order", desc=False).order("created_at", desc=False)

        return self._select_many(
            "system_hard_rules",
            "list system hard rules",
            build_query,
        )

    def get_system_hard_rule(self, rule_id: str) -> dict[str, Any] | None:
        return self._select_one(
            "system_hard_rules",
            "read system hard rule",
            lambda table: table.select("*").eq("id", rule_id).limit(1),
        )

    def get_system_hard_rule_by_code(self, code: str) -> dict[str, Any] | None:
        return self._select_one(
            "system_hard_rules",
            "read system hard rule by code",
            lambda table: table.select("*").eq("code", code).limit(1),
        )

    def get_max_system_hard_rule_sort_order(self) -> int:
        rows = self._select_many(
            "system_hard_rules",
            "read max system hard rule sort order",
            lambda table: table.select("sort_order").order("sort_order", desc=True).limit(1),
        )
        if not rows:
            return 0
        value = rows[0].get("sort_order", 0)
        return int(value) if isinstance(value, int) else 0

    def count_enabled_system_hard_rules(self) -> int:
        rows = self._select_many(
            "system_hard_rules",
            "count enabled system hard rules",
            lambda table: table.select("id").eq("is_enabled", True),
        )
        return len(rows)

    def create_system_hard_rule(self, data: dict[str, Any]) -> dict[str, Any]:
        rule_id = str(data.get("id") or uuid4())
        payload = self._encode({"id": rule_id, **data})
        rows = self._execute(
            "create system hard rule",
            lambda: self.client.table("system_hard_rules").insert(payload).execute(),
        )
        if rows:
            return rows[0]
        rule = self.get_system_hard_rule(rule_id)
        if rule is None:
            raise AppError("System hard rule creation succeeded but no record was returned.", status_code=500)
        return rule

    def update_system_hard_rule(self, rule_id: str, data: dict[str, Any]) -> dict[str, Any]:
        if self.get_system_hard_rule(rule_id) is None:
            raise AppError("未找到指定系统硬约束规则。", status_code=404)

        payload = self._encode(
            data,
            exclude_fields={"id", "code", "created_at", "created_by"},
        )
        if payload:
            self._execute(
                "update system hard rule",
                lambda: self.client.table("system_hard_rules").update(payload).eq("id", rule_id).execute(),
            )

        rule = self.get_system_hard_rule(rule_id)
        if rule is None:
            raise AppError("System hard rule update succeeded but no record was returned.", status_code=500)
        return rule

    def create_system_rule_change_log(self, data: dict[str, Any]) -> dict[str, Any]:
        log_id = str(data.get("id") or uuid4())
        payload = self._encode({"id": log_id, **data})
        rows = self._execute(
            "create system rule change log",
            lambda: self.client.table("system_rule_change_logs").insert(payload).execute(),
        )
        if rows:
            return rows[0]
        return {"id": log_id, **payload}

    def list_system_rule_change_logs(
        self,
        *,
        limit: int = 50,
        rule_id: str | None = None,
    ) -> list[dict[str, Any]]:
        def build_query(table: Any) -> Any:
            query = table.select("*")
            if rule_id:
                query = query.eq("rule_id", rule_id)
            return query.order("changed_at", desc=True).limit(limit)

        return self._select_many(
            "system_rule_change_logs",
            "list system rule change logs",
            build_query,
        )

    def list_audit_templates(self, user_id: str) -> list[dict[str, Any]]:
        return self._select_many(
            "audit_templates",
            "list audit templates",
            lambda table: table.select("*")
            .eq("user_id", user_id)
            .order("is_default", desc=True)
            .order("updated_at", desc=True),
        )

    def get_audit_template(self, template_id: str, user_id: str) -> dict[str, Any] | None:
        return self._select_one(
            "audit_templates",
            "read audit template",
            lambda table: table.select("*").eq("id", template_id).eq("user_id", user_id).limit(1),
        )

    def create_audit_template(self, user_id: str, data: dict[str, Any]) -> dict[str, Any]:
        payload = self._encode(data)
        payload["user_id"] = user_id
        self._execute(
            "create audit template",
            lambda: self.client.table("audit_templates").insert(payload).execute(),
        )
        template_id = str(payload.get("id", ""))
        template = self.get_audit_template(template_id, user_id)
        if template is None:
            raise AppError("Audit template creation succeeded but no record was returned.", status_code=500)
        return template

    def update_audit_template(
        self,
        template_id: str,
        user_id: str,
        data: dict[str, Any],
    ) -> dict[str, Any]:
        existing = self.get_audit_template(template_id, user_id)
        if existing is None:
            raise AppError("Audit template not found.", status_code=404)

        payload = self._encode(data, exclude_fields={"id", "user_id", "created_at"})
        if payload:
            self._execute(
                "update audit template",
                lambda: self.client.table("audit_templates")
                .update(payload)
                .eq("id", template_id)
                .eq("user_id", user_id)
                .execute(),
            )

        template = self.get_audit_template(template_id, user_id)
        if template is None:
            raise AppError("Audit template update succeeded but no record was returned.", status_code=500)
        return template

    def delete_audit_template(self, template_id: str, user_id: str) -> None:
        if self.get_audit_template(template_id, user_id) is None:
            raise AppError("Audit template not found.", status_code=404)

        self._execute(
            "delete audit template",
            lambda: self.client.table("audit_templates").delete().eq("id", template_id).eq("user_id", user_id).execute(),
        )

    def clear_default_audit_templates(self, user_id: str, exclude_template_id: str | None = None) -> None:
        payload = self._encode({"is_default": False, "updated_at": datetime.now(timezone.utc)})

        def build_query() -> Any:
            query = (
                self.client.table("audit_templates")
                .update(payload)
                .eq("user_id", user_id)
                .eq("is_default", True)
            )
            if exclude_template_id:
                query = query.neq("id", exclude_template_id)
            return query.execute()

        self._execute(
            "clear default audit templates",
            build_query,
        )

    def create_audit_history(self, user_id: str, data: dict[str, Any]) -> dict[str, Any]:
        payload = self._encode({"user_id": user_id, **data})
        optional_columns = {"audit_rule_snapshot", "task_id", "report_paths"}
        retry_payload = dict(payload)

        while True:
            try:
                return self._create_audit_history_payload(user_id, retry_payload)
            except AppError as exc:
                missing_columns = self._missing_optional_history_columns(exc, optional_columns)
                if not missing_columns:
                    raise

                for column in missing_columns:
                    retry_payload.pop(column, None)
                logger.warning(
                    "Audit history optional columns are unavailable; retrying without %s.",
                    ", ".join(sorted(missing_columns)),
                    exc_info=True,
                )

    def _create_audit_history_payload(self, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        self._execute(
            "create audit history",
            lambda: self.client.table("audit_history").insert(payload).execute(),
        )
        audit_id = str(payload.get("id", ""))
        record = self.get_audit_history(audit_id, user_id)
        if record is None:
            raise AppError("Audit history creation succeeded but no record was returned.", status_code=500)
        return record

    def get_audit_history_by_task_id(self, user_id: str, task_id: str) -> dict[str, Any] | None:
        return self._select_one(
            "audit_history",
            "read audit history by task",
            lambda table: table.select("*").eq("user_id", user_id).eq("task_id", task_id).limit(1),
        )

    def upload_report_file(self, bucket: str, path: str, data: bytes, content_type: str) -> bool:
        try:
            if hasattr(self.client, "upload_storage_object"):
                self.client.upload_storage_object(bucket, path, data, content_type)
            else:
                storage = getattr(self.client, "storage", None)
                if storage is None:
                    raise AppError("Supabase storage is not available.", status_code=500)
                storage.from_(bucket).upload(
                    path,
                    data,
                    file_options={
                        "content-type": content_type,
                        "upsert": "true",
                    },
                )
            return True
        except Exception:
            logger.warning("Supabase report upload failed for %s/%s.", bucket, path, exc_info=True)
            return False

    def download_report_file(self, bucket: str, path: str) -> bytes | None:
        try:
            if hasattr(self.client, "download_storage_object"):
                data = self.client.download_storage_object(bucket, path)
            else:
                storage = getattr(self.client, "storage", None)
                if storage is None:
                    raise AppError("Supabase storage is not available.", status_code=500)
                data = storage.from_(bucket).download(path)
            return bytes(data) if isinstance(data, (bytes, bytearray)) else None
        except Exception:
            logger.warning("Supabase report download failed for %s/%s.", bucket, path, exc_info=True)
            return None

    def list_audit_history(self, user_id: str, page: int = 1, page_size: int = 20) -> list[dict[str, Any]]:
        page_size = max(page_size, 1)
        offset = (max(page, 1) - 1) * page_size
        base_columns = (
            "id,model_used,document_count,red_count,yellow_count,blue_count,created_at"
        )
        columns_with_optional = (
            "id,model_used,document_count,red_count,yellow_count,blue_count,deep_think_used,created_at"
        )

        try:
            return self._select_audit_history_page(user_id, columns_with_optional, offset, page_size)
        except AppError as exc:
            missing_columns = self._missing_optional_history_columns(exc, {"deep_think_used"})
            if "deep_think_used" not in missing_columns:
                raise
            logger.warning(
                "Audit history list optional column is unavailable; retrying without deep_think_used.",
                exc_info=True,
            )
            return self._select_audit_history_page(user_id, base_columns, offset, page_size)

    def _select_audit_history_page(
        self,
        user_id: str,
        columns: str,
        offset: int,
        page_size: int,
    ) -> list[dict[str, Any]]:
        return self._select_many(
            "audit_history",
            "list audit history",
            lambda table: table.select(columns)
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(page_size)
            .offset(offset),
        )

    def count_audit_history(self, user_id: str) -> int:
        try:
            response = (
                self.client.table("audit_history")
                .select("id", count="exact")
                .eq("user_id", user_id)
                .execute()
            )
        except Exception as exc:
            raise AppError("Supabase count audit history failed.", status_code=500) from exc
        return int(getattr(response, "count", 0) or 0)

    def get_audit_history(self, audit_id: str, user_id: str) -> dict[str, Any] | None:
        return self._select_one(
            "audit_history",
            "read audit history",
            lambda table: table.select("*").eq("user_id", user_id).eq("id", audit_id).limit(1),
        )

    def insert_history(self, data: dict[str, Any]) -> dict[str, Any]:
        user_id = str(data.get("user_id", ""))
        return self.create_audit_history(user_id, data)

    def list_history(self, user_id: str) -> list[dict[str, Any]]:
        return self.list_audit_history(user_id)

    def get_history_detail(self, user_id: str, history_id: str) -> dict[str, Any] | None:
        return self.get_audit_history(history_id, user_id)

    def _prepare_profile_payload(
        self,
        data: dict[str, Any],
        *,
        exclude_fields: set[str] | None = None,
    ) -> dict[str, Any]:
        payload = self._encode(data, exclude_fields=exclude_fields)
        for field_name in API_KEY_FIELDS:
            value = payload.get(field_name)
            if value in (None, ""):
                continue
            if not isinstance(value, str):
                continue
            if self._looks_encrypted(value):
                continue
            if not self.cipher.is_configured():
                raise AppError("ENCRYPTION_KEY is required to store API keys.", status_code=500)
            payload[field_name] = self.cipher.encrypt(value)
        return payload

    def _hydrate_profile(self, profile: dict[str, Any]) -> dict[str, Any]:
        hydrated = dict(profile)
        for field_name in API_KEY_FIELDS:
            value = hydrated.get(field_name)
            if not value or not isinstance(value, str):
                continue
            if not self.cipher.is_configured():
                continue
            try:
                hydrated[field_name] = self.cipher.decrypt(value)
            except Exception:
                hydrated[field_name] = value
        return hydrated

    def _select_one(
        self,
        table_name: str,
        action: str,
        build_query: Any,
    ) -> dict[str, Any] | None:
        rows = self._select_many(table_name, action, build_query)
        return rows[0] if rows else None

    def _select_many(
        self,
        table_name: str,
        action: str,
        build_query: Any,
    ) -> list[dict[str, Any]]:
        return self._execute(action, lambda: build_query(self.client.table(table_name)).execute())

    def _execute(self, action: str, operation: Any) -> list[dict[str, Any]]:
        try:
            response = operation()
        except AppError:
            raise
        except Exception as exc:
            raise AppError(f"Supabase {action} failed.", status_code=500) from exc
        return self._normalize_rows(response)

    @staticmethod
    def _missing_optional_history_columns(error: Exception, optional_columns: set[str]) -> set[str]:
        normalized = SupabaseRepository._normalized_error_message(error)
        mentions_schema_issue = any(
            token in normalized
            for token in (
                "column",
                "schema cache",
                "could not find",
                "unknown",
                "undefined",
                "pgrst204",
            )
        )
        if not mentions_schema_issue:
            return set()
        return {column for column in optional_columns if column in normalized}

    @staticmethod
    def _normalized_error_message(error: Exception) -> str:
        messages: list[str] = []
        current: BaseException | None = error
        while current is not None:
            messages.append(str(current))
            current = current.__cause__
        return " ".join(messages).lower()

    @staticmethod
    def _is_report_metadata_column_error(error: Exception) -> bool:
        return bool(
            SupabaseRepository._missing_optional_history_columns(
                error,
                {"task_id", "report_paths"},
            )
        )

    @staticmethod
    def _normalize_rows(response: Any) -> list[dict[str, Any]]:
        data = getattr(response, "data", None)
        if isinstance(data, list):
            return [item for item in data if isinstance(item, dict)]
        if isinstance(data, dict):
            return [data]
        return []

    @staticmethod
    def _encode(
        data: dict[str, Any],
        *,
        exclude_fields: set[str] | None = None,
    ) -> dict[str, Any]:
        payload = jsonable_encoder(data, exclude_none=False)
        if exclude_fields:
            for field_name in exclude_fields:
                payload.pop(field_name, None)
        return payload

    @staticmethod
    def _looks_encrypted(value: str) -> bool:
        return value.startswith("gAAAA")


@lru_cache
def get_data_store() -> SupabaseRepository | None:
    """Return a repository instance only when Supabase is configured."""

    if not is_supabase_configured():
        return None

    client = get_supabase_client()
    if client is None:
        return None

    return SupabaseRepository(client=client)
