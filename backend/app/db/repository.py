"""Supabase-backed CRUD helpers for persisted runtime tables."""

from __future__ import annotations

from datetime import datetime, timezone
from functools import lru_cache
from typing import Any

from fastapi.encoders import jsonable_encoder

from app.db.supabase_client import (
    ApiKeyCipher,
    get_api_key_cipher,
    get_supabase_client,
    is_supabase_configured,
)
from app.errors import AppError

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
        return self.update_profile(
            user_id,
            {
                "wizard_completed": True,
                "active_custom_rules": list(custom_rules),
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

    def list_templates(
        self,
        user_id: str,
        include_system: bool = True,
    ) -> list[dict[str, Any]]:
        query = self.client.table("industry_templates").select("*")
        if include_system and user_id:
            query = query.or_(f"is_system.eq.true,user_id.eq.{user_id}")
        elif include_system:
            query = query.eq("is_system", True)
        else:
            query = query.eq("user_id", user_id)

        return self._select_many(
            "industry_templates",
            "list templates",
            lambda table: query.order("is_system", desc=True).order("name"),
        )

    def get_template(
        self,
        template_id: str,
        user_id: str | None = None,
    ) -> dict[str, Any] | None:
        query = self.client.table("industry_templates").select("*").eq("id", template_id)
        if user_id:
            query = query.or_(f"is_system.eq.true,user_id.eq.{user_id}")
        rows = self._execute("read template", lambda: query.limit(1).execute())
        return rows[0] if rows else None

    def create_template(
        self,
        user_id: str | None,
        data: dict[str, Any],
    ) -> dict[str, Any]:
        payload = self._encode(data)
        payload["user_id"] = user_id if user_id is not None else payload.get("user_id")
        self._execute(
            "create template",
            lambda: self.client.table("industry_templates").insert(payload).execute(),
        )
        template_id = str(payload.get("id", ""))
        template = self.get_template(template_id)
        if template is None:
            raise AppError("Template creation succeeded but no record was returned.", status_code=500)
        return template

    def update_template(
        self,
        template_id: str,
        user_id: str | None,
        data: dict[str, Any],
    ) -> dict[str, Any]:
        template = self.get_template(template_id)
        if template is None:
            raise AppError("Template not found.", status_code=404)

        payload = self._encode(data, exclude_fields={"id", "created_at"})
        if user_id is None and "user_id" not in payload and not bool(template.get("is_system")):
            payload["user_id"] = template.get("user_id")
        if payload:
            self._execute(
                "update template",
                lambda: self.client.table("industry_templates").update(payload).eq("id", template_id).execute(),
            )

        refreshed = self.get_template(template_id)
        if refreshed is None:
            raise AppError("Template update succeeded but no record was returned.", status_code=500)
        return refreshed

    def delete_template(self, template_id: str, user_id: str | None) -> None:
        del user_id
        if self.get_template(template_id) is None:
            raise AppError("Template not found.", status_code=404)

        self._execute(
            "delete template",
            lambda: self.client.table("industry_templates").delete().eq("id", template_id).execute(),
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

    def create_audit_history(self, user_id: str, data: dict[str, Any]) -> dict[str, Any]:
        payload = self._encode({"user_id": user_id, **data})
        self._execute(
            "create audit history",
            lambda: self.client.table("audit_history").insert(payload).execute(),
        )
        audit_id = str(payload.get("id", ""))
        record = self.get_audit_history(audit_id, user_id)
        if record is None:
            raise AppError("Audit history creation succeeded but no record was returned.", status_code=500)
        return record

    def list_audit_history(self, user_id: str) -> list[dict[str, Any]]:
        return self._select_many(
            "audit_history",
            "list audit history",
            lambda table: table.select("*").eq("user_id", user_id).order("created_at", desc=True),
        )

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
