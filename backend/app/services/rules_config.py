from app.config import Settings
from app.models.schemas import FeatureStatus, RulesCapability


class RulesConfigService:
    """Central place for future template and custom rule configuration."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def get_capability(self) -> RulesCapability:
        return RulesCapability(
            scopes=["industry-template", "custom-rule", "prompt-guidance"],
            features=[
                FeatureStatus(
                    name="规则配置入口",
                    ready=False,
                    note="规则数据结构和编辑能力将在后续轮次实现。",
                ),
                FeatureStatus(
                    name="行业模板边界",
                    ready=False,
                    note="本轮只补齐模块位置，不提供真实模板数据。",
                ),
            ],
        )

