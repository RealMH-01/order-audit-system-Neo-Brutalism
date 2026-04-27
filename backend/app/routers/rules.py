from fastapi import APIRouter, Depends, HTTPException

from app.dependencies import get_current_user, get_rules_config_service
from app.models.schemas import (
    BuiltinRuleFullResponse,
    BuiltinRulePublicResponse,
    BuiltinRuleUpdateRequest,
    CurrentUser,
    CustomRulesResponse,
    CustomRulesUpdateRequest,
    RulesCapability,
)
from app.services.rules_config import RulesConfigService

router = APIRouter()

LEGACY_TEMPLATE_GONE_MESSAGE = "旧规则模板体系已下线，请使用审核模板功能。"


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


def _raise_legacy_template_gone() -> None:
    raise HTTPException(status_code=410, detail=LEGACY_TEMPLATE_GONE_MESSAGE)


@router.get("/templates", summary="旧规则模板体系已下线")
async def list_legacy_templates(
    _: CurrentUser = Depends(get_current_user),
) -> None:
    _raise_legacy_template_gone()


@router.post("/templates", summary="旧规则模板体系已下线")
async def create_legacy_template(
    _: CurrentUser = Depends(get_current_user),
) -> None:
    _raise_legacy_template_gone()


@router.put("/templates/{template_id}", summary="旧规则模板体系已下线")
async def update_legacy_template(
    template_id: str,
    _: CurrentUser = Depends(get_current_user),
) -> None:
    del template_id
    _raise_legacy_template_gone()


@router.delete("/templates/{template_id}", summary="旧规则模板体系已下线")
async def delete_legacy_template(
    template_id: str,
    _: CurrentUser = Depends(get_current_user),
) -> None:
    del template_id
    _raise_legacy_template_gone()


@router.post("/templates/{template_id}/load", summary="旧规则模板体系已下线")
async def load_legacy_template(
    template_id: str,
    _: CurrentUser = Depends(get_current_user),
) -> None:
    del template_id
    _raise_legacy_template_gone()
