"""提供默认规则文本、模板内容以及 rules 模块的最小接口闭环。"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from app.config import Settings
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
    IndustryTemplateSeed,
    RulesCapability,
    SystemRuleSeed,
    TemplateCreateRequest,
    TemplateListResponse,
    TemplateLoadResponse,
    TemplateResponse,
    TemplateUpdateRequest,
)
from app.services.runtime_store import RuntimeStore


DEFAULT_SYSTEM_KEY = "default"

DEFAULT_DISPLAY_RULE_TEXT = """
1. 以用户上传的基准单据为准，逐字段比对待审核单据中的核心信息。
2. 对数量、金额、币种、品名、型号、收发货主体、交付节点保持高度敏感。
3. 明确区分严重错误、需人工确认项和信息性提示。
4. 若依据不足，不要臆断，直接标注为“需人工确认”。
5. 输出内容应保持脱敏、可追踪、便于跟单员复核。
""".strip()

DEFAULT_PROMPT_RULE_TEXT = """
You are an enterprise document audit assistant.
Compare each uploaded business document against the base document selected by the user.

Follow these principles:
- treat the base document as the primary source of truth unless the user explicitly overrides it
- classify issues into RED, YELLOW, and BLUE
- RED means a clear mismatch or missing critical field
- YELLOW means a suspicious inconsistency or item that needs human confirmation
- BLUE means a useful notice or low-risk reminder
- do not invent values that do not appear in the source material
- keep company names and examples generic unless the user explicitly provides them
- output should stay concise, structured, and review-friendly
""".strip()


def build_default_system_templates() -> list[IndustryTemplateSeed]:
    """返回默认系统模板内容，避免示例公司名扩散到系统逻辑。"""

    return [
        IndustryTemplateSeed(
            name="通用货物出口审核模板",
            description="适用于一般货物贸易单据的字段核对与异常分级。",
            rules_text="""
请重点核对以下内容：
- 买方、卖方、收货方、通知方是否一致或合理映射
- 品名、规格、数量、单价、总价、币种是否一致
- 包装件数、毛净重、体积、唛头是否与装箱信息匹配
- 交货条款、装运期、目的港、运输方式是否存在冲突
- 任何缺失的关键字段都需要明确标注
""".strip(),
            company_affiliates=["buyer", "seller", "consignee", "notify_party"],
        ),
        IndustryTemplateSeed(
            name="通用多主体协作模板",
            description="适用于需要记录多家关联主体和职责分工的业务场景。",
            rules_text="""
请在审核时同步关注：
- 关联主体名单是否完整
- 每个主体在业务链路中的职责是否清晰
- 单据抬头、联系人和签发主体是否与业务角色一致
- 自定义审核规则是否覆盖到关键协作节点
""".strip(),
            company_affiliates=["principal", "agent", "logistics_partner", "warehouse"],
        ),
    ]


class RulesConfigService:
    """集中提供系统规则、自定义规则和模板的最小闭环。"""

    def __init__(self, settings: Settings, store: RuntimeStore) -> None:
        self.settings = settings
        self.store = store
        self._ensure_bootstrap_data()

    def get_capability(self) -> RulesCapability:
        return RulesCapability(
            scopes=["industry-template", "custom-rule", "prompt-guidance", "database-bootstrap"],
            features=[
                FeatureStatus(
                    name="系统规则读取与更新",
                    ready=True,
                    note="已提供管理员更新和全体登录用户读取的最小闭环。",
                ),
                FeatureStatus(
                    name="自定义规则管理",
                    ready=True,
                    note="已提供当前用户自定义规则的读取与覆盖更新。",
                ),
                FeatureStatus(
                    name="模板读取与加载",
                    ready=True,
                    note="已提供系统模板/个人模板列表，以及模板加载到当前用户规则的闭环。",
                ),
            ],
        )

    def get_default_system_rule(self) -> SystemRuleSeed:
        return SystemRuleSeed(
            key=DEFAULT_SYSTEM_KEY,
            display_text=DEFAULT_DISPLAY_RULE_TEXT,
            prompt_text=DEFAULT_PROMPT_RULE_TEXT,
        )

    def get_default_templates(self) -> list[IndustryTemplateSeed]:
        return build_default_system_templates()

    def get_bootstrap_plan(self) -> BootstrapDataPlan:
        return BootstrapDataPlan(
            system_rule=self.get_default_system_rule(),
            system_templates=self.get_default_templates(),
            note="默认数据初始化应保持幂等，不生成重复系统规则和系统模板。",
        )

    def get_builtin_public(self) -> BuiltinRulePublicResponse:
        rule = self._get_system_rule()
        return BuiltinRulePublicResponse(
            key=rule["key"],
            display_text=rule["display_text"],
            updated_at=rule["updated_at"],
        )

    def get_builtin_full(self) -> BuiltinRuleFullResponse:
        rule = self._get_system_rule()
        return BuiltinRuleFullResponse(
            key=rule["key"],
            display_text=rule["display_text"],
            prompt_text=rule["prompt_text"],
            updated_at=rule["updated_at"],
        )

    def update_builtin(
        self,
        current_user: CurrentUser,
        payload: BuiltinRuleUpdateRequest,
    ) -> BuiltinRuleFullResponse:
        if current_user.role != "admin":
            raise AppError("只有管理员可以修改系统通用规则。", status_code=403)

        rule = self._get_system_rule()
        rule["display_text"] = payload.display_text
        rule["prompt_text"] = payload.prompt_text
        rule["updated_by"] = current_user.id
        rule["updated_at"] = datetime.now(timezone.utc)
        self.store.system_rule = rule
        return self.get_builtin_full()

    def get_custom_rules(self, current_user: CurrentUser) -> CustomRulesResponse:
        profile = self._get_profile(current_user.id)
        return CustomRulesResponse(rules=list(profile.get("active_custom_rules", [])))

    def update_custom_rules(
        self,
        current_user: CurrentUser,
        payload: CustomRulesUpdateRequest,
    ) -> CustomRulesResponse:
        profile = self._get_profile(current_user.id)
        profile["active_custom_rules"] = payload.rules
        profile["updated_at"] = datetime.now(timezone.utc)
        return CustomRulesResponse(rules=payload.rules)

    def list_templates(self, current_user: CurrentUser) -> TemplateListResponse:
        templates = [
            self._to_template_response(template)
            for template in self.store.templates.values()
            if template["is_system"] or template.get("user_id") == current_user.id
        ]
        templates.sort(key=lambda item: (not item.is_system, item.name.lower()))
        return TemplateListResponse(templates=templates)

    def create_template(
        self,
        current_user: CurrentUser,
        payload: TemplateCreateRequest,
    ) -> TemplateResponse:
        now = datetime.now(timezone.utc)
        template_id = str(uuid4())
        record = {
            "id": template_id,
            "name": payload.name,
            "description": payload.description,
            "rules_text": payload.rules_text,
            "company_affiliates": payload.company_affiliates,
            "is_system": False,
            "user_id": current_user.id,
            "created_at": now,
            "updated_at": now,
        }
        self.store.templates[template_id] = record
        return self._to_template_response(record)

    def update_template(
        self,
        current_user: CurrentUser,
        template_id: str,
        payload: TemplateUpdateRequest,
    ) -> TemplateResponse:
        template = self._get_accessible_template(current_user, template_id)
        if template["is_system"] and current_user.role != "admin":
            raise AppError("只有管理员可以修改系统模板。", status_code=403)
        if not template["is_system"] and template.get("user_id") != current_user.id:
            raise AppError("你只能修改自己创建的模板。", status_code=403)

        template.update(payload.model_dump(exclude_unset=True))
        template["updated_at"] = datetime.now(timezone.utc)
        return self._to_template_response(template)

    def delete_template(self, current_user: CurrentUser, template_id: str) -> None:
        template = self._get_accessible_template(current_user, template_id)
        if template["is_system"]:
            if current_user.role != "admin":
                raise AppError("只有管理员可以删除系统模板。", status_code=403)
        elif template.get("user_id") != current_user.id:
            raise AppError("你只能删除自己创建的模板。", status_code=403)
        del self.store.templates[template_id]

    def load_template(self, current_user: CurrentUser, template_id: str) -> TemplateLoadResponse:
        template = self._get_accessible_template(current_user, template_id)
        profile = self._get_profile(current_user.id)
        profile["active_custom_rules"] = [template["rules_text"]]
        profile["updated_at"] = datetime.now(timezone.utc)
        return TemplateLoadResponse(
            template=self._to_template_response(template),
            loaded_rules=list(profile["active_custom_rules"]),
            message="模板内容已加载到当前用户的自定义规则中。",
        )

    def _ensure_bootstrap_data(self) -> None:
        if self.store.system_rule is None:
            now = datetime.now(timezone.utc)
            self.store.system_rule = {
                "key": DEFAULT_SYSTEM_KEY,
                "display_text": DEFAULT_DISPLAY_RULE_TEXT,
                "prompt_text": DEFAULT_PROMPT_RULE_TEXT,
                "updated_by": None,
                "updated_at": now,
            }

        if not any(template["is_system"] for template in self.store.templates.values()):
            now = datetime.now(timezone.utc)
            for seed in self.get_default_templates():
                template_id = str(uuid4())
                self.store.templates[template_id] = {
                    "id": template_id,
                    "name": seed.name,
                    "description": seed.description,
                    "rules_text": seed.rules_text,
                    "company_affiliates": seed.company_affiliates,
                    "is_system": True,
                    "user_id": None,
                    "created_at": now,
                    "updated_at": now,
                }

    def _get_system_rule(self) -> dict[str, object]:
        if self.store.system_rule is None:
            self._ensure_bootstrap_data()
        return dict(self.store.system_rule or {})

    def _get_profile(self, user_id: str) -> dict[str, object]:
        profile = self.store.profiles.get(user_id)
        if not profile:
            raise AppError("当前用户资料不存在，请重新登录后再试。", status_code=404)
        return profile

    def _get_accessible_template(
        self,
        current_user: CurrentUser,
        template_id: str,
    ) -> dict[str, object]:
        template = self.store.templates.get(template_id)
        if not template:
            raise AppError("未找到指定模板。", status_code=404)
        if template["is_system"] or template.get("user_id") == current_user.id:
            return template
        raise AppError("你无权访问该模板。", status_code=403)

    @staticmethod
    def _to_template_response(template: dict[str, object]) -> TemplateResponse:
        return TemplateResponse(
            id=str(template["id"]),
            name=str(template["name"]),
            description=str(template.get("description", "")),
            rules_text=str(template["rules_text"]),
            company_affiliates=list(template.get("company_affiliates", [])),
            is_system=bool(template["is_system"]),
            user_id=template.get("user_id"),  # type: ignore[arg-type]
            created_at=template.get("created_at"),  # type: ignore[arg-type]
            updated_at=template.get("updated_at"),  # type: ignore[arg-type]
        )
