from app.models.schemas import FeatureStatus


class ReportGeneratorService:
    """Placeholder for future Excel report generation and export formatting."""

    def get_features(self) -> list[FeatureStatus]:
        return [
            FeatureStatus(
                name="审核报告导出",
                ready=False,
                note="Excel 报告生成将在后续轮次接入。",
            )
        ]

