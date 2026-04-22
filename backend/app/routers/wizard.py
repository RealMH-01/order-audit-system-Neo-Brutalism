from fastapi import APIRouter, Depends

from app.dependencies import get_wizard_engine_service
from app.models.schemas import WizardCapability
from app.services.wizard_engine import WizardEngineService

router = APIRouter()


@router.get("/capabilities", response_model=WizardCapability, summary="引导能力说明")
async def get_wizard_capabilities(
    service: WizardEngineService = Depends(get_wizard_engine_service),
) -> WizardCapability:
    return service.get_capability()

