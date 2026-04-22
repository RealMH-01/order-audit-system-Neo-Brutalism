from fastapi import Depends

from app.config import Settings, get_settings
from app.services.audit_orchestrator import AuditOrchestratorService
from app.services.file_parser import FileParserService
from app.services.llm_client import LLMClientService
from app.services.report_generator import ReportGeneratorService
from app.services.rules_config import RulesConfigService
from app.services.token_utils import TokenUtilityService
from app.services.wizard_engine import WizardEngineService


def get_app_settings() -> Settings:
    return get_settings()


def get_file_parser_service(
    settings: Settings = Depends(get_app_settings),
) -> FileParserService:
    return FileParserService(settings=settings)


def get_llm_client_service(
    settings: Settings = Depends(get_app_settings),
) -> LLMClientService:
    return LLMClientService(settings=settings)


def get_rules_config_service(
    settings: Settings = Depends(get_app_settings),
) -> RulesConfigService:
    return RulesConfigService(settings=settings)


def get_token_utility_service() -> TokenUtilityService:
    return TokenUtilityService()


def get_report_generator_service() -> ReportGeneratorService:
    return ReportGeneratorService()


def get_wizard_engine_service(
    settings: Settings = Depends(get_app_settings),
) -> WizardEngineService:
    return WizardEngineService(settings=settings)


def get_audit_orchestrator_service(
    settings: Settings = Depends(get_app_settings),
    file_parser: FileParserService = Depends(get_file_parser_service),
    llm_client: LLMClientService = Depends(get_llm_client_service),
    report_generator: ReportGeneratorService = Depends(get_report_generator_service),
    token_utils: TokenUtilityService = Depends(get_token_utility_service),
) -> AuditOrchestratorService:
    return AuditOrchestratorService(
        settings=settings,
        file_parser=file_parser,
        llm_client=llm_client,
        report_generator=report_generator,
        token_utils=token_utils,
    )

