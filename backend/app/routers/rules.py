from fastapi import APIRouter, Depends

from app.dependencies import get_current_user, get_rules_config_service
from app.models.schemas import (
    BuiltinRuleFullResponse,
    BuiltinRulePublicResponse,
    BuiltinRuleUpdateRequest,
    CurrentUser,
    CustomRulesResponse,
    CustomRulesUpdateRequest,
    MessageResponse,
    RulesCapability,
    TemplateCreateRequest,
    TemplateListResponse,
    TemplateLoadResponse,
    TemplateResponse,
    TemplateUpdateRequest,
)
from app.services.rules_config import RulesConfigService

router = APIRouter()


@router.get("/capabilities", response_model=RulesCapability, summary="规则能力说明")
async def get_rules_capabilities(
    service: RulesConfigService = Depends(get_rules_config_service),
) -> RulesCapability:
    return service.get_capability()


@router.get("/builtin", response_model=BuiltinRulePublicResponse)
async def get_builtin_rule(
    _: CurrentUser = Depends(get_current_user),
    service: RulesConfigService = Depends(get_rules_config_service),
) -> BuiltinRulePublicResponse:
    return service.get_builtin_public()


@router.get("/builtin/full", response_model=BuiltinRuleFullResponse)
async def get_builtin_rule_full(
    _: CurrentUser = Depends(get_current_user),
    service: RulesConfigService = Depends(get_rules_config_service),
) -> BuiltinRuleFullResponse:
    return service.get_builtin_full()


@router.put("/builtin", response_model=BuiltinRuleFullResponse)
async def update_builtin_rule(
    payload: BuiltinRuleUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
    service: RulesConfigService = Depends(get_rules_config_service),
) -> BuiltinRuleFullResponse:
    return service.update_builtin(current_user, payload)


@router.get("/custom", response_model=CustomRulesResponse)
async def get_custom_rules(
    current_user: CurrentUser = Depends(get_current_user),
    service: RulesConfigService = Depends(get_rules_config_service),
) -> CustomRulesResponse:
    return service.get_custom_rules(current_user)


@router.put("/custom", response_model=CustomRulesResponse)
async def update_custom_rules(
    payload: CustomRulesUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
    service: RulesConfigService = Depends(get_rules_config_service),
) -> CustomRulesResponse:
    return service.update_custom_rules(current_user, payload)


@router.get("/templates", response_model=TemplateListResponse)
async def list_templates(
    current_user: CurrentUser = Depends(get_current_user),
    service: RulesConfigService = Depends(get_rules_config_service),
) -> TemplateListResponse:
    return service.list_templates(current_user)


@router.post("/templates", response_model=TemplateResponse)
async def create_template(
    payload: TemplateCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
    service: RulesConfigService = Depends(get_rules_config_service),
) -> TemplateResponse:
    return service.create_template(current_user, payload)


@router.put("/templates/{template_id}", response_model=TemplateResponse)
async def update_template(
    template_id: str,
    payload: TemplateUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
    service: RulesConfigService = Depends(get_rules_config_service),
) -> TemplateResponse:
    return service.update_template(current_user, template_id, payload)


@router.delete("/templates/{template_id}", response_model=MessageResponse)
async def delete_template(
    template_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    service: RulesConfigService = Depends(get_rules_config_service),
) -> MessageResponse:
    service.delete_template(current_user, template_id)
    return MessageResponse(message="模板已删除。")


@router.post("/templates/{template_id}/load", response_model=TemplateLoadResponse)
async def load_template(
    template_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    service: RulesConfigService = Depends(get_rules_config_service),
) -> TemplateLoadResponse:
    return service.load_template(current_user, template_id)
