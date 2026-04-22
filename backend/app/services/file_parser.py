from app.config import Settings
from app.models.schemas import FeatureStatus, FileCapability


class FileParserService:
    """Owns file intake and parsing boundaries without implementing them yet."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def get_capability(self) -> FileCapability:
        return FileCapability(
            supported_types=["pdf", "docx", "xlsx", "png", "jpg", "jpeg"],
            features=[
                FeatureStatus(
                    name="文件上传入口",
                    ready=False,
                    note="仅保留能力边界，上传与解析管线将在后续轮次接入。",
                ),
                FeatureStatus(
                    name="文档类型识别",
                    ready=False,
                    note="PO、发票、装箱单等自动识别逻辑尚未实现。",
                ),
            ],
        )

