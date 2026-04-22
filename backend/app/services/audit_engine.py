from app.models.schemas import FeatureStatus


class AuditEngineService:
    """Future field-by-field comparison engine placeholder."""

    def get_features(self) -> list[FeatureStatus]:
        return [
            FeatureStatus(
                name="字段级比对引擎",
                ready=False,
                note="RED / YELLOW / BLUE 规则判断将在后续轮次实现。",
            )
        ]

