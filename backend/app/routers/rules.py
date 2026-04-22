from fastapi import APIRouter, Depends

from app.dependencies import get_rules_config_service
from app.models.schemas import RulesCapability
from app.services.rules_config import RulesConfigService

router = APIRouter()


@router.get("/capabilities", response_model=RulesCapability, summary="规则能力说明")
async def get_rules_capabilities(
    service: RulesConfigService = Depends(get_rules_config_service),
) -> RulesCapability:
    return service.get_capability()

