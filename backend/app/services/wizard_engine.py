from app.config import Settings
from app.models.schemas import FeatureStatus, WizardCapability


class WizardEngineService:
    """Future guided onboarding engine placeholder."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def get_capability(self) -> WizardCapability:
        return WizardCapability(
            phases=["collect-context", "suggest-template", "confirm-rules"],
            features=[
                FeatureStatus(
                    name="向导流程骨架",
                    ready=False,
                    note="只保留问答式引导的模块边界，不实现多轮对话逻辑。",
                )
            ],
        )

