from fastapi import APIRouter, Depends, Query

from app.dependencies import (
    get_current_user,
    get_system_rules_admin_service,
    get_system_rules_service,
    require_admin,
)
from app.models.schemas import (
    AdminSystemRuleResponse,
    CurrentUser,
    PublicSystemRuleResponse,
    SystemRuleChangeLogResponse,
    SystemRuleCreateRequest,
    SystemRuleUpdateRequest,
)
from app.services.system_rules_admin import SystemRulesAdminService

router = APIRouter()


@router.get("/admin/system-rules", response_model=list[AdminSystemRuleResponse])
async def list_admin_system_rules(
    _: CurrentUser = Depends(require_admin),
    service: SystemRulesAdminService = Depends(get_system_rules_admin_service),
) -> list[AdminSystemRuleResponse]:
    return service.list_admin_system_rules()


@router.post("/admin/system-rules", response_model=AdminSystemRuleResponse)
async def create_admin_system_rule(
    payload: SystemRuleCreateRequest,
    current_user: CurrentUser = Depends(require_admin),
    service: SystemRulesAdminService = Depends(get_system_rules_admin_service),
) -> AdminSystemRuleResponse:
    return service.create_system_rule(current_user, payload)


@router.get("/admin/system-rules/change-logs", response_model=list[SystemRuleChangeLogResponse])
async def list_admin_system_rule_change_logs(
    _: CurrentUser = Depends(require_admin),
    service: SystemRulesAdminService = Depends(get_system_rules_admin_service),
    limit: int = Query(default=50, ge=1, le=200),
    rule_id: str | None = None,
) -> list[SystemRuleChangeLogResponse]:
    return service.list_change_logs(limit=limit, rule_id=rule_id)


@router.patch("/admin/system-rules/{rule_id}", response_model=AdminSystemRuleResponse)
async def update_admin_system_rule(
    rule_id: str,
    payload: SystemRuleUpdateRequest,
    current_user: CurrentUser = Depends(require_admin),
    service: SystemRulesAdminService = Depends(get_system_rules_admin_service),
) -> AdminSystemRuleResponse:
    return service.update_system_rule(current_user, rule_id, payload)


@router.get("/system-rules", response_model=list[PublicSystemRuleResponse])
async def list_active_system_rules(
    _: CurrentUser = Depends(get_current_user),
    service: SystemRulesAdminService = Depends(get_system_rules_service),
) -> list[PublicSystemRuleResponse]:
    return service.list_active_system_rules()
