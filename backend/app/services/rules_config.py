"""System and custom rule configuration service."""

from __future__ import annotations

from datetime import datetime, timezone

from app.config import Settings
from app.db.repository import SupabaseRepository
from app.errors import AppError
from app.models.schemas import (
    BootstrapDataPlan,
    BuiltinRuleFullResponse,
    BuiltinRulePublicResponse,
    BuiltinRuleUpdateRequest,
    CurrentUser,
    CustomRulesResponse,
    CustomRulesUpdateRequest,
    FeatureStatus,
    RulesCapability,
    SystemRuleSeed,
)
from app.services.audit_engine import build_default_display_text, build_default_prompt_text
from app.services.runtime_store import RuntimeStore

DEFAULT_SYSTEM_KEY = "default"
DEFAULT_DISPLAY_RULE_TEXT = build_default_display_text()
DEFAULT_PROMPT_RULE_TEXT = build_default_prompt_text()


class RulesConfigService:
    """Manage system built-in rules and per-user custom rules."""

    def __init__(
        self,
        settings: Settings,
        store: RuntimeStore,
        repo: SupabaseRepository | None = None,
    ) -> None:
        self.settings = settings
        self.store = store
        self.repo = repo
        self._ensure_bootstrap_data()

    def get_capability(self) -> RulesCapability:
        """Return the currently supported rule-management capabilities."""

        return RulesCapability(
            scopes=["custom-rule", "system-rule", "prompt-guidance"],
            features=[
                FeatureStatus(
                    name="系统规则初始化与读取",
                    ready=True,
                    note="默认 display_text 和 prompt_text 与审核引擎规则口径对齐。",
                ),
                FeatureStatus(
                    name="自定义规则读写",
                    ready=True,
                    note="当前用户的自定义规则可读写；配置 Supabase 后会持久化到 profiles.active_custom_rules。",
                ),
                FeatureStatus(
                    name="旧规则模板",
                    ready=False,
                    note="旧 industry_templates 规则模板体系已下线，请使用审核模板功能。",
                ),
            ],
        )

    def get_default_system_rule(self) -> SystemRuleSeed:
        """Return the default system-rule record."""

        return SystemRuleSeed(
            key=DEFAULT_SYSTEM_KEY,
            display_text=DEFAULT_DISPLAY_RULE_TEXT,
            prompt_text=DEFAULT_PROMPT_RULE_TEXT,
        )

    def get_bootstrap_plan(self) -> BootstrapDataPlan:
        """Return the bootstrap plan without legacy industry template seeds."""

        return BootstrapDataPlan(
            system_rule=self.get_default_system_rule(),
            system_templates=[],
            note="默认系统规则使用幂等初始化；旧 industry_templates 模板不再初始化。",
        )

    def get_builtin_public(self) -> BuiltinRulePublicResponse:
        """Read the public system-rule summary."""

        rule = self._get_system_rule()
        return BuiltinRulePublicResponse(
            key=str(rule["key"]),
            display_text=str(rule["display_text"]),
            updated_at=rule.get("updated_at"),
        )

    def get_builtin_full(self) -> BuiltinRuleFullResponse:
        """Read the full system-rule prompt."""

        rule = self._get_system_rule()
        return BuiltinRuleFullResponse(
            key=str(rule["key"]),
            display_text=str(rule["display_text"]),
            prompt_text=str(rule["prompt_text"]),
            updated_at=rule.get("updated_at"),
        )

    def update_builtin(
        self,
        current_user: CurrentUser,
        payload: BuiltinRuleUpdateRequest,
    ) -> BuiltinRuleFullResponse:
        """Update the system rule. Admin only."""

        if current_user.role != "admin":
            raise AppError("只有管理员可以修改系统通用规则。", status_code=403)

        rule = self._get_system_rule()
        rule["display_text"] = payload.display_text
        rule["prompt_text"] = payload.prompt_text
        rule["updated_by"] = current_user.id
        rule["updated_at"] = datetime.now(timezone.utc)
        rule = self._save_system_rule(rule)
        return BuiltinRuleFullResponse(
            key=str(rule["key"]),
            display_text=str(rule["display_text"]),
            prompt_text=str(rule["prompt_text"]),
            updated_at=rule.get("updated_at"),
        )

    def get_custom_rules(self, current_user: CurrentUser) -> CustomRulesResponse:
        """Read the current user's custom rules."""

        profile = self._get_profile(current_user.id)
        return CustomRulesResponse(rules=list(profile.get("active_custom_rules", [])))

    def update_custom_rules(
        self,
        current_user: CurrentUser,
        payload: CustomRulesUpdateRequest,
    ) -> CustomRulesResponse:
        """Replace the current user's custom rules."""

        profile = self._get_profile(current_user.id)
        profile["active_custom_rules"] = list(payload.rules)
        profile["updated_at"] = datetime.now(timezone.utc)
        profile = self._save_profile(current_user.id, profile)
        return CustomRulesResponse(rules=list(profile.get("active_custom_rules", [])))

    def _ensure_bootstrap_data(self) -> None:
        """Ensure the system rule exists without seeding legacy templates."""

        if self.repo is not None:
            if self.repo.get_system_rules() is None:
                self.repo.upsert_system_rules(self.get_default_system_rule().model_dump())

            rule = self.repo.get_system_rules()
            if rule is not None:
                self.store.system_rule = rule
            return

        if self.store.system_rule is None:
            now = datetime.now(timezone.utc)
            self.store.system_rule = {
                "key": DEFAULT_SYSTEM_KEY,
                "display_text": DEFAULT_DISPLAY_RULE_TEXT,
                "prompt_text": DEFAULT_PROMPT_RULE_TEXT,
                "updated_by": None,
                "updated_at": now,
            }

    def _get_system_rule(self) -> dict[str, object]:
        """Get the runtime system-rule record."""

        if self.repo is not None:
            rule = self.repo.get_system_rules()
            if rule is None:
                self._ensure_bootstrap_data()
                rule = self.repo.get_system_rules()
            if rule is None:
                raise AppError("系统规则尚未初始化，请稍后重试。", status_code=500)
            self.store.system_rule = rule
            return dict(rule)

        if self.store.system_rule is None:
            self._ensure_bootstrap_data()
        return dict(self.store.system_rule or {})

    def _get_profile(self, user_id: str) -> dict[str, object]:
        """Read the current user profile."""

        if self.repo is not None:
            profile = self.repo.get_profile(user_id)
            if profile:
                self.store.profiles[user_id] = profile
                return profile

        profile = self.store.profiles.get(user_id)
        if not profile:
            raise AppError("当前用户资料不存在，请重新登录后再试。", status_code=404)
        return profile

    def _save_profile(self, user_id: str, profile: dict[str, object]) -> dict[str, object]:
        if self.repo is not None:
            if self.repo.get_profile(user_id) is None:
                profile = self.repo.upsert_profile(user_id, profile)
            else:
                profile = self.repo.update_profile(
                    user_id,
                    {
                        "active_custom_rules": profile.get("active_custom_rules", []),
                        "company_affiliates": profile.get("company_affiliates", []),
                        "company_affiliates_roles": profile.get("company_affiliates_roles", []),
                        "wizard_completed": profile.get("wizard_completed", False),
                        "updated_at": profile.get("updated_at"),
                    },
                )
        self.store.profiles[user_id] = profile
        return profile

    def _save_system_rule(self, rule: dict[str, object]) -> dict[str, object]:
        if self.repo is not None:
            if self.repo.get_system_rules() is None:
                rule = self.repo.upsert_system_rules(rule)
            else:
                rule = self.repo.update_system_rules(rule)
        self.store.system_rule = rule
        return rule
