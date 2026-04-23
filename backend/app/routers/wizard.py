from fastapi import APIRouter, Depends

from app.dependencies import get_current_user, get_wizard_engine_service
from app.models.schemas import (
    CurrentUser,
    WizardCapability,
    WizardChatRequest,
    WizardChatResponse,
    WizardCompleteRequest,
    WizardSkipRequest,
    WizardSkipResponse,
    WizardStartRequest,
    WizardStartResponse,
)
from app.services.wizard_engine import WizardEngineService

router = APIRouter()


@router.get("/capabilities", response_model=WizardCapability, summary="引导能力说明")
async def get_wizard_capabilities(
    service: WizardEngineService = Depends(get_wizard_engine_service),
) -> WizardCapability:
    return service.get_capability()


@router.post("/start", response_model=WizardStartResponse)
async def start_wizard(
    payload: WizardStartRequest,
    current_user: CurrentUser = Depends(get_current_user),
    service: WizardEngineService = Depends(get_wizard_engine_service),
) -> WizardStartResponse:
    return await service.start(current_user, payload)


@router.post("/chat", response_model=WizardChatResponse)
async def chat_wizard(
    payload: WizardChatRequest,
    current_user: CurrentUser = Depends(get_current_user),
    service: WizardEngineService = Depends(get_wizard_engine_service),
) -> WizardChatResponse:
    return await service.chat(current_user, payload)


@router.post("/complete", response_model=WizardSkipResponse)
async def complete_wizard(
    payload: WizardCompleteRequest,
    current_user: CurrentUser = Depends(get_current_user),
    service: WizardEngineService = Depends(get_wizard_engine_service),
) -> WizardSkipResponse:
    return service.complete(current_user, payload)


@router.post("/skip", response_model=WizardSkipResponse)
async def skip_wizard(
    payload: WizardSkipRequest,
    current_user: CurrentUser = Depends(get_current_user),
    service: WizardEngineService = Depends(get_wizard_engine_service),
) -> WizardSkipResponse:
    return service.skip(current_user, payload)
