"""提供默认 system_rules 和 industry_templates 的幂等初始化逻辑。"""

from __future__ import annotations

from typing import Any

from app.config import Settings, get_settings
from app.models.schemas import (
    BootstrapDataPlan,
    DatabaseBootstrapResult,
    IndustryTemplateSeed,
    SeedExecutionResult,
    SystemRuleSeed,
)
from app.services.rules_config import RulesConfigService


class DatabaseInitializer:
    """负责初始化默认 system_rules 和 industry_templates，且保证幂等。"""

    def __init__(self, client: Any | None = None, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self.client = client
        self.rules_config = RulesConfigService(self.settings)

    def get_bootstrap_plan(self) -> BootstrapDataPlan:
        """返回本次初始化会涉及的默认数据计划。"""

        return self.rules_config.get_bootstrap_plan()

    def run(self) -> DatabaseBootstrapResult:
        """执行默认数据初始化；若无数据库客户端则返回跳过说明。"""

        if self.client is None:
            return DatabaseBootstrapResult(
                executed=False,
                message="未检测到可用的 Supabase 客户端，默认数据初始化已跳过。",
                results=[],
            )

        results: list[SeedExecutionResult] = []
        results.append(self._ensure_system_rule(self.rules_config.get_default_system_rule()))

        for index, template in enumerate(self.rules_config.get_default_templates(), start=1):
            results.append(self._ensure_system_template(template, index))

        return DatabaseBootstrapResult(
            executed=True,
            message="默认规则与系统模板初始化完成。",
            results=results,
        )

    def _ensure_system_rule(self, seed: SystemRuleSeed) -> SeedExecutionResult:
        existing = self._query_first("system_rules", filters=[("key", seed.key)])
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

    def _ensure_system_template(
        self,
        seed: IndustryTemplateSeed,
        index: int,
    ) -> SeedExecutionResult:
        existing = self._query_first(
            "industry_templates",
            filters=[
                ("is_system", True),
                ("rules_text", seed.rules_text),
                ("company_affiliates", seed.company_affiliates),
            ],
        )
        if existing:
            return SeedExecutionResult(
                entity="industry_templates",
                identifier=f"system-template-{index}",
                action="skipped",
                detail="已存在同内容的系统模板，跳过插入。",
            )

        self.client.table("industry_templates").insert(seed.model_dump()).execute()
        return SeedExecutionResult(
            entity="industry_templates",
            identifier=f"system-template-{index}",
            action="inserted",
            detail="已插入默认系统模板。",
        )

    def _query_first(
        self,
        table_name: str,
        filters: list[tuple[str, Any]],
    ) -> dict[str, Any] | None:
        query = self.client.table(table_name).select("*")
        for column, value in filters:
            query = query.eq(column, value)
        response = query.limit(1).execute()
        data = getattr(response, "data", None) or []
        return data[0] if data else None
