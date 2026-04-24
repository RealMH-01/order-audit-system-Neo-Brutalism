"""Idempotent bootstrap helpers for default system rules and templates."""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from app.config import Settings, get_settings
from app.db.supabase_client import get_supabase_client
from app.models.schemas import (
    BootstrapDataPlan,
    DatabaseBootstrapResult,
    IndustryTemplateSeed,
    SeedExecutionResult,
    SystemRuleSeed,
)
from app.services.rules_config import (
    DEFAULT_SYSTEM_KEY,
    build_default_display_text,
    build_default_prompt_text,
    build_default_system_templates,
)


class DatabaseInitializer:
    """Bootstrap default records in Supabase without creating duplicates."""

    def __init__(self, client: Any | None = None, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self.client = client or get_supabase_client()

    def get_bootstrap_plan(self) -> BootstrapDataPlan:
        return BootstrapDataPlan(
            system_rule=SystemRuleSeed(
                key=DEFAULT_SYSTEM_KEY,
                display_text=build_default_display_text(),
                prompt_text=build_default_prompt_text(),
            ),
            system_templates=build_default_system_templates(),
            note="默认规则与默认系统模板使用幂等初始化，重复执行不会生成重复记录。",
        )

    def run(self) -> DatabaseBootstrapResult:
        if self.client is None:
            return DatabaseBootstrapResult(
                executed=False,
                message="未检测到可用的 Supabase 客户端，默认数据初始化已跳过。",
                results=[],
            )

        plan = self.get_bootstrap_plan()
        results = [self._ensure_system_rule(plan.system_rule)]

        existing_templates = self._query(
            "industry_templates",
            lambda query: query.eq("is_system", True),
        )
        existing_signatures = {
            (
                str(item.get("name", "")),
                str(item.get("rules_text", "")),
                tuple(item.get("company_affiliates", [])),
            )
            for item in existing_templates
        }

        for index, template in enumerate(plan.system_templates, start=1):
            signature = (template.name, template.rules_text, tuple(template.company_affiliates))
            if signature in existing_signatures:
                results.append(
                    SeedExecutionResult(
                        entity="industry_templates",
                        identifier=f"system-template-{index}",
                        action="skipped",
                        detail="已存在同内容的系统模板，跳过插入。",
                    )
                )
                continue

            payload = template.model_dump()
            payload["id"] = str(uuid4())
            self.client.table("industry_templates").insert(payload).execute()
            existing_signatures.add(signature)
            results.append(
                SeedExecutionResult(
                    entity="industry_templates",
                    identifier=f"system-template-{index}",
                    action="inserted",
                    detail="已插入默认系统模板。",
                )
            )

        return DatabaseBootstrapResult(
            executed=True,
            message="默认规则与系统模板初始化完成。",
            results=results,
        )

    def _ensure_system_rule(self, seed: SystemRuleSeed) -> SeedExecutionResult:
        existing = self._query(
            "system_rules",
            lambda query: query.eq("key", seed.key),
            limit=1,
        )
        if existing:
            return SeedExecutionResult(
                entity="system_rules",
                identifier=seed.key,
                action="skipped",
                detail="已存在同 key 的默认系统规则，跳过插入。",
            )

        self.client.table("system_rules").insert(seed.model_dump()).execute()
        return SeedExecutionResult(
            entity="system_rules",
            identifier=seed.key,
            action="inserted",
            detail="已插入默认系统规则。",
        )

    def _query(
        self,
        table_name: str,
        apply_filters: Any | None = None,
        *,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        query = self.client.table(table_name).select("*")
        if apply_filters is not None:
            query = apply_filters(query)
        if limit is not None:
            query = query.limit(limit)
        response = query.execute()
        data = getattr(response, "data", None) or []
        if isinstance(data, list):
            return [item for item in data if isinstance(item, dict)]
        if isinstance(data, dict):
            return [data]
        return []
