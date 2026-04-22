from app.config import Settings
from app.models.schemas import AuditCapability, FeatureStatus
from app.services.audit_engine import AuditEngineService
from app.services.file_parser import FileParserService
from app.services.llm_client import LLMClientService
from app.services.report_generator import ReportGeneratorService
from app.services.token_utils import TokenUtilityService


class AuditOrchestratorService:
    """Coordinates future parser, model, engine and report modules."""

    def __init__(
        self,
        settings: Settings,
        file_parser: FileParserService,
        llm_client: LLMClientService,
        report_generator: ReportGeneratorService,
        token_utils: TokenUtilityService,
    ) -> None:
        self.settings = settings
        self.file_parser = file_parser
        self.llm_client = llm_client
        self.report_generator = report_generator
        self.token_utils = token_utils
        self.audit_engine = AuditEngineService()

    def get_capability(self) -> AuditCapability:
        return AuditCapability(
            mode="skeleton",
            features=[
                FeatureStatus(
                    name="并行审核调度",
                    ready=False,
                    note="后续会用 asyncio 编排多文件审核任务。",
                ),
                FeatureStatus(
                    name="模型调用协调",
                    ready=False,
                    note="当前只保留 orchestrator 结构，不执行真实模型请求。",
                ),
                *self.audit_engine.get_features(),
                *self.report_generator.get_features(),
                *self.token_utils.get_features(),
            ],
        )

