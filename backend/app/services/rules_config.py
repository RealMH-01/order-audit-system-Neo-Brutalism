"""系统规则配置：默认规则文本、模板种子和规则相关最小服务闭环。"""

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
from app.services.audit_engine import build_default_display_text, build_default_prompt_text
from app.services.runtime_store import RuntimeStore

DEFAULT_SYSTEM_KEY = "default"
DEFAULT_DISPLAY_RULE_TEXT = build_default_display_text()
DEFAULT_PROMPT_RULE_TEXT = build_default_prompt_text()


def build_default_system_templates() -> list[IndustryTemplateSeed]:
    """返回默认系统模板，保持通用化与脱敏。"""

    return [
        IndustryTemplateSeed(
            name="通用外贸单据审核模板",
            description="适用于商业发票、装箱单、托书等常见单据的基础审核场景。",
            rules_text="""
请重点检查：
- 单据中的合同号、Invoice No.、订单号、PO 号是否分别填写且概念不混淆
- 品名、规格、数量、单价、总价、币种是否与 PO 一致
- 贸易术语是否发生实质性变化，而不是单纯大小写、空格或书写差异
- 箱数、毛重、净重、体积、包装方式是否与其他字段和 PO 逻辑一致
- 若出现单位换算，请判断是否有充分上下文支持，只能降级为需要人工确认的 YELLOW，不可随意忽略
""".strip(),
            company_affiliates=["buyer", "seller", "consignee", "notify_party"],
        ),
        IndustryTemplateSeed(
            name="集团关联主体审核模板",
            description="适用于存在集团内关联公司、多个业务主体协作的审核场景。",
            rules_text="""
请在基础审核之外额外关注：
- 集团关联公司名称差异是否确实属于同一集团和合理业务角色映射
- 关联主体差异只能在主体名称层面做谨慎降级，不能覆盖合同号、订单号、数量、金额、币种等刚性错误
- 若主体关系不清晰，应标记为 YELLOW 或 RED，而不是默认视为同一主体
""".strip(),
            company_affiliates=["principal", "affiliate", "agent", "warehouse", "logistics_partner"],
        ),
    ]


class RulesConfigService:
    """集中管理系统规则、自定义规则和模板的最小服务逻辑。"""

    def __init__(self, settings: Settings, store: RuntimeStore) -> None:
        self.settings = settings
        self.store = store
        self._ensure_bootstrap_data()

    def get_capability(self) -> RulesCapability:
        """返回当前规则模块能力说明。"""

        return RulesCapability(
            scopes=["industry-template", "custom-rule", "system-rule", "prompt-guidance"],
            features=[
                FeatureStatus(
                    name="系统规则初始化与读取",
                    ready=True,
                    note="默认 display_text 和 prompt_text 已与审核引擎规则口径对齐。",
                ),
                FeatureStatus(
                    name="自定义规则读写",
                    ready=True,
                    note="当前用户的自定义规则可读写，后续可接入更完整的数据库持久化。",
                ),
                FeatureStatus(
                    name="模板读取与加载",
                    ready=True,
                    note="系统模板和当前用户模板可读取，模板可加载到当前用户自定义规则。",
                ),
            ],
        )

    def get_default_system_rule(self) -> SystemRuleSeed:
        """返回默认系统规则记录。"""

        return SystemRuleSeed(
            key=DEFAULT_SYSTEM_KEY,
            display_text=DEFAULT_DISPLAY_RULE_TEXT,
            prompt_text=DEFAULT_PROMPT_RULE_TEXT,
        )

    def get_default_templates(self) -> list[IndustryTemplateSeed]:
        """返回默认系统模板集合。"""

        return build_default_system_templates()

    def get_bootstrap_plan(self) -> BootstrapDataPlan:
        """返回规则模块初始化计划说明。"""

        return BootstrapDataPlan(
            system_rule=self.get_default_system_rule(),
            system_templates=self.get_default_templates(),
            note="默认规则与模板初始化应保持幂等，重复执行不得创建重复记录。",
        )

    def get_builtin_public(self) -> BuiltinRulePublicResponse:
        """读取系统规则摘要。"""

        rule = self._get_system_rule()
        return BuiltinRulePublicResponse(
            key=str(rule["key"]),
            display_text=str(rule["display_text"]),
            updated_at=rule.get("updated_at"),
        )

    def get_builtin_full(self) -> BuiltinRuleFullResponse:
        """读取系统规则完整 prompt。"""

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
        """更新系统规则，只有管理员可用。"""

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
        """读取当前用户的自定义规则。"""

        profile = self._get_profile(current_user.id)
        return CustomRulesResponse(rules=list(profile.get("active_custom_rules", [])))

    def update_custom_rules(
        self,
        current_user: CurrentUser,
        payload: CustomRulesUpdateRequest,
    ) -> CustomRulesResponse:
        """覆盖更新当前用户的自定义规则。"""

        profile = self._get_profile(current_user.id)
        profile["active_custom_rules"] = list(payload.rules)
        profile["updated_at"] = datetime.now(timezone.utc)
        self.store.profiles[current_user.id] = profile
        return CustomRulesResponse(rules=list(payload.rules))

    def list_templates(self, current_user: CurrentUser) -> TemplateListResponse:
        """列出系统模板和当前用户自己的模板。"""

        templates = [
            self._to_template_response(template)
            for template in self.store.templates.values()
            if bool(template["is_system"]) or template.get("user_id") == current_user.id
        ]
        templates.sort(key=lambda item: (not item.is_system, item.name.lower()))
        return TemplateListResponse(templates=templates)

    def create_template(
        self,
        current_user: CurrentUser,
        payload: TemplateCreateRequest,
    ) -> TemplateResponse:
        """创建用户自定义模板。"""

        now = datetime.now(timezone.utc)
        template_id = str(uuid4())
        record = {
            "id": template_id,
            "name": payload.name,
            "description": payload.description,
            "rules_text": payload.rules_text,
            "company_affiliates": list(payload.company_affiliates),
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
        """更新模板；系统模板仅管理员可改。"""

        template = self._get_accessible_template(current_user, template_id)
        if bool(template["is_system"]) and current_user.role != "admin":
            raise AppError("只有管理员可以修改系统模板。", status_code=403)
        if not bool(template["is_system"]) and template.get("user_id") != current_user.id:
            raise AppError("你只能修改自己创建的模板。", status_code=403)

        template.update(payload.model_dump(exclude_unset=True))
        template["updated_at"] = datetime.now(timezone.utc)
        return self._to_template_response(template)

    def delete_template(self, current_user: CurrentUser, template_id: str) -> None:
        """删除模板；系统模板仅管理员可删。"""

        template = self._get_accessible_template(current_user, template_id)
        if bool(template["is_system"]):
            if current_user.role != "admin":
                raise AppError("只有管理员可以删除系统模板。", status_code=403)
        elif template.get("user_id") != current_user.id:
            raise AppError("你只能删除自己创建的模板。", status_code=403)
        del self.store.templates[template_id]

    def load_template(self, current_user: CurrentUser, template_id: str) -> TemplateLoadResponse:
        """把模板内容加载为当前用户的自定义规则。"""

        template = self._get_accessible_template(current_user, template_id)
        profile = self._get_profile(current_user.id)
        profile["active_custom_rules"] = [str(template["rules_text"])]
        profile["updated_at"] = datetime.now(timezone.utc)
        self.store.profiles[current_user.id] = profile
        return TemplateLoadResponse(
            template=self._to_template_response(template),
            loaded_rules=list(profile["active_custom_rules"]),
            message="模板内容已加载到当前用户的自定义规则中。",
        )

    def _ensure_bootstrap_data(self) -> None:
        """确保系统规则和系统模板已在运行态初始化。"""

        if self.store.system_rule is None:
            now = datetime.now(timezone.utc)
            self.store.system_rule = {
                "key": DEFAULT_SYSTEM_KEY,
                "display_text": DEFAULT_DISPLAY_RULE_TEXT,
                "prompt_text": DEFAULT_PROMPT_RULE_TEXT,
                "updated_by": None,
                "updated_at": now,
            }

        if not any(bool(template["is_system"]) for template in self.store.templates.values()):
            now = datetime.now(timezone.utc)
            for seed in self.get_default_templates():
                template_id = str(uuid4())
                self.store.templates[template_id] = {
                    "id": template_id,
                    "name": seed.name,
                    "description": seed.description,
                    "rules_text": seed.rules_text,
                    "company_affiliates": list(seed.company_affiliates),
                    "is_system": True,
                    "user_id": None,
                    "created_at": now,
                    "updated_at": now,
                }

    def _get_system_rule(self) -> dict[str, object]:
        """获取运行态系统规则记录。"""

        if self.store.system_rule is None:
            self._ensure_bootstrap_data()
        return dict(self.store.system_rule or {})

    def _get_profile(self, user_id: str) -> dict[str, object]:
        """读取当前用户 profile。"""

        profile = self.store.profiles.get(user_id)
        if not profile:
            raise AppError("当前用户资料不存在，请重新登录后再试。", status_code=404)
        return profile

    def _get_accessible_template(
        self,
        current_user: CurrentUser,
        template_id: str,
    ) -> dict[str, object]:
        """根据权限读取模板。"""

        template = self.store.templates.get(template_id)
        if not template:
            raise AppError("未找到指定模板。", status_code=404)
        if bool(template["is_system"]) or template.get("user_id") == current_user.id:
            return template
        raise AppError("你无权访问该模板。", status_code=403)

    @staticmethod
    def _to_template_response(template: dict[str, object]) -> TemplateResponse:
        """把模板字典转换成响应对象。"""

        return TemplateResponse(
            id=str(template["id"]),
            name=str(template["name"]),
            description=str(template.get("description", "")),
            rules_text=str(template["rules_text"]),
            company_affiliates=list(template.get("company_affiliates", [])),
            is_system=bool(template["is_system"]),
            user_id=template.get("user_id"),
            created_at=template.get("created_at"),
            updated_at=template.get("updated_at"),
        )
