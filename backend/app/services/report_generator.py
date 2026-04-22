from app.models.schemas import FeatureStatus


class ReportGeneratorService:
    """提供报告导出能力说明占位。"""

    def get_features(self) -> list[FeatureStatus]:
        return [
            FeatureStatus(
                name="审核报告导出",
                ready=False,
                note="Excel 报告生成将在后续轮次接入。",
            )
        ]
