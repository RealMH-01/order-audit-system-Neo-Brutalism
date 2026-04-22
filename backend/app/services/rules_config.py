"""提供默认规则文本、默认模板内容以及数据库初始化所需的配置。"""

from __future__ import annotations

from app.config import Settings
from app.models.schemas import (
    BootstrapDataPlan,
    FeatureStatus,
    IndustryTemplateSeed,
    RulesCapability,
    SystemRuleSeed,
)


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
    """集中提供默认规则、模板和规则模块能力描述。"""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def get_capability(self) -> RulesCapability:
        return RulesCapability(
            scopes=["industry-template", "custom-rule", "prompt-guidance", "database-bootstrap"],
            features=[
                FeatureStatus(
                    name="默认系统规则文本",
                    ready=True,
                    note="已提供可落库的默认展示规则与 prompt 规则。",
                ),
                FeatureStatus(
                    name="默认系统模板",
                    ready=True,
                    note="已提供通用化、脱敏的系统模板初始化内容。",
                ),
                FeatureStatus(
                    name="规则 CRUD",
                    ready=False,
                    note="完整规则管理接口将在后续轮次实现。",
                ),
            ],
        )

    def get_default_system_rule(self) -> SystemRuleSeed:
        """返回系统默认规则记录。"""

        return SystemRuleSeed(
            key=DEFAULT_SYSTEM_KEY,
            display_text=DEFAULT_DISPLAY_RULE_TEXT,
            prompt_text=DEFAULT_PROMPT_RULE_TEXT,
        )

    def get_default_templates(self) -> list[IndustryTemplateSeed]:
        """返回所有默认系统模板。"""

        return build_default_system_templates()

    def get_bootstrap_plan(self) -> BootstrapDataPlan:
        """返回初始化脚本使用的默认规则与模板清单。"""

        return BootstrapDataPlan(
            system_rule=self.get_default_system_rule(),
            system_templates=self.get_default_templates(),
            note="默认数据初始化应保持幂等，不生成重复系统规则和系统模板。",
        )
