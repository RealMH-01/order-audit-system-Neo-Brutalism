from app.models.schemas import FeatureStatus


class TokenUtilityService:
    """Reserves token estimation responsibilities for future LLM orchestration."""

    def get_features(self) -> list[FeatureStatus]:
        return [
            FeatureStatus(
                name="Token 估算",
                ready=False,
                note="当前只保留工具模块位置，尚未接入真实估算逻辑。",
            )
        ]

