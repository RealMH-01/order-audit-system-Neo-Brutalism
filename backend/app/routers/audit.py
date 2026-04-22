from fastapi import APIRouter, Depends

from app.dependencies import get_audit_orchestrator_service
from app.models.schemas import AuditCapability
from app.services.audit_orchestrator import AuditOrchestratorService

router = APIRouter()


@router.get("/capabilities", response_model=AuditCapability, summary="审核能力说明")
async def get_audit_capabilities(
    service: AuditOrchestratorService = Depends(get_audit_orchestrator_service),
) -> AuditCapability:
    return service.get_capability()

