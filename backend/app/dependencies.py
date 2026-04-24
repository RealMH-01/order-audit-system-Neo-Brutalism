from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import Settings, get_settings
from app.db.repository import SupabaseRepository, get_data_store
from app.db.supabase_client import ApiKeyCipher, get_api_key_cipher, is_supabase_configured
from app.errors import AppError
from app.models.schemas import CurrentUser
from app.services.audit_orchestrator import AuditOrchestratorService
from app.services.auth_service import AuthService
from app.services.file_parser import FileParserService
from app.services.llm_client import LLMClientService
from app.services.report_generator import ReportGeneratorService
from app.services.rules_config import RulesConfigService
from app.services.runtime_store import RuntimeStore, get_runtime_store
from app.services.settings_service import SettingsService
from app.services.token_utils import TokenUtilityService
from app.services.wizard_engine import WizardEngineService

bearer_scheme = HTTPBearer(auto_error=False)


def get_app_settings() -> Settings:
    return get_settings()


def get_runtime_state() -> RuntimeStore:
    return get_runtime_store()


def get_api_cipher() -> ApiKeyCipher:
    return get_api_key_cipher()


def get_repository() -> SupabaseRepository | None:
    if not is_supabase_configured():
        return None
    return get_data_store()


def get_auth_service(
    settings: Settings = Depends(get_app_settings),
    store: RuntimeStore = Depends(get_runtime_state),
    repo: SupabaseRepository | None = Depends(get_repository),
) -> AuthService:
    return AuthService(settings=settings, store=store, repo=repo)


def get_file_parser_service(
    settings: Settings = Depends(get_app_settings),
    store: RuntimeStore = Depends(get_runtime_state),
) -> FileParserService:
    return FileParserService(settings=settings, store=store)


def get_llm_client_service(
    settings: Settings = Depends(get_app_settings),
) -> LLMClientService:
    return LLMClientService(settings=settings)


def get_rules_config_service(
    settings: Settings = Depends(get_app_settings),
    store: RuntimeStore = Depends(get_runtime_state),
    repo: SupabaseRepository | None = Depends(get_repository),
) -> RulesConfigService:
    return RulesConfigService(settings=settings, store=store, repo=repo)


def get_token_utility_service() -> TokenUtilityService:
    return TokenUtilityService()


def get_report_generator_service() -> ReportGeneratorService:
    return ReportGeneratorService()


def get_wizard_engine_service(
    settings: Settings = Depends(get_app_settings),
    store: RuntimeStore = Depends(get_runtime_state),
    llm_client: LLMClientService = Depends(get_llm_client_service),
    cipher: ApiKeyCipher = Depends(get_api_cipher),
    repo: SupabaseRepository | None = Depends(get_repository),
) -> WizardEngineService:
    return WizardEngineService(
        settings=settings,
        store=store,
        llm_client=llm_client,
        cipher=cipher,
        repo=repo,
    )


def get_settings_service(
    settings: Settings = Depends(get_app_settings),
    store: RuntimeStore = Depends(get_runtime_state),
    cipher: ApiKeyCipher = Depends(get_api_cipher),
    repo: SupabaseRepository | None = Depends(get_repository),
) -> SettingsService:
    return SettingsService(settings=settings, store=store, cipher=cipher, repo=repo)


def get_audit_orchestrator_service(
    settings: Settings = Depends(get_app_settings),
    file_parser: FileParserService = Depends(get_file_parser_service),
    llm_client: LLMClientService = Depends(get_llm_client_service),
    report_generator: ReportGeneratorService = Depends(get_report_generator_service),
    token_utils: TokenUtilityService = Depends(get_token_utility_service),
    store: RuntimeStore = Depends(get_runtime_state),
    repo: SupabaseRepository | None = Depends(get_repository),
) -> AuditOrchestratorService:
    return AuditOrchestratorService(
        settings=settings,
        file_parser=file_parser,
        llm_client=llm_client,
        report_generator=report_generator,
        token_utils=token_utils,
        store=store,
        repo=repo,
    )


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    auth_service: AuthService = Depends(get_auth_service),
) -> CurrentUser:
    if credentials is None or not credentials.credentials:
        raise AppError("请先登录后再访问该接口。", status_code=401)
    return auth_service.get_current_user(credentials.credentials)
