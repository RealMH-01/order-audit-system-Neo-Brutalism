from app.config import Settings
from app.models.schemas import FeatureStatus


class LLMClientService:
    """Declares supported providers and keeps future client wiring in one place."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def get_provider_features(self) -> list[FeatureStatus]:
        return [
            FeatureStatus(
                name="OpenAI / DeepSeek / 智谱接入位",
                ready=True,
                note="环境变量读取已准备好，真实模型调用后续接入。",
            ),
            FeatureStatus(
                name="OCR 自动切换策略",
                ready=False,
                note="扫描件与视觉模型切换逻辑尚未实现。",
            ),
        ]

