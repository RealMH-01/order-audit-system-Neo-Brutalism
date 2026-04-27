from fastapi import APIRouter, Depends

from app.dependencies import get_current_user, get_template_library_service
from app.models.schemas import (
    AuditTemplateCreateRequest,
    AuditTemplateListResponse,
    AuditTemplateResponse,
    AuditTemplateUpdateRequest,
    CurrentUser,
    MessageResponse,
    SystemHardRulesResponse,
)
from app.services.template_library import TemplateLibraryService

router = APIRouter()


@router.get("/system-rules", response_model=SystemHardRulesResponse)
async def get_system_hard_rules(
    service: TemplateLibraryService = Depends(get_template_library_service),
) -> SystemHardRulesResponse:
    return service.get_system_hard_rules()


@router.get("", response_model=AuditTemplateListResponse)
async def list_templates(
    current_user: CurrentUser = Depends(get_current_user),
    service: TemplateLibraryService = Depends(get_template_library_service),
) -> AuditTemplateListResponse:
    return service.list_templates(current_user)


@router.post("", response_model=AuditTemplateResponse)
async def create_template(
    payload: AuditTemplateCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
    service: TemplateLibraryService = Depends(get_template_library_service),
) -> AuditTemplateResponse:
    return service.create_template(current_user, payload)


@router.get("/{template_id}", response_model=AuditTemplateResponse)
async def get_template(
    template_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    service: TemplateLibraryService = Depends(get_template_library_service),
) -> AuditTemplateResponse:
    return service.get_template(current_user, template_id)


@router.patch("/{template_id}", response_model=AuditTemplateResponse)
async def update_template(
    template_id: str,
    payload: AuditTemplateUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
    service: TemplateLibraryService = Depends(get_template_library_service),
) -> AuditTemplateResponse:
    return service.update_template(current_user, template_id, payload)


@router.delete("/{template_id}", response_model=MessageResponse)
async def delete_template(
    template_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    service: TemplateLibraryService = Depends(get_template_library_service),
) -> MessageResponse:
    service.delete_template(current_user, template_id)
    return MessageResponse(message="模板已删除。")


@router.post("/{template_id}/duplicate", response_model=AuditTemplateResponse)
async def duplicate_template(
    template_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    service: TemplateLibraryService = Depends(get_template_library_service),
) -> AuditTemplateResponse:
    return service.duplicate_template(current_user, template_id)


@router.post("/{template_id}/set-default", response_model=AuditTemplateResponse)
async def set_default_template(
    template_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    service: TemplateLibraryService = Depends(get_template_library_service),
) -> AuditTemplateResponse:
    return service.set_default_template(current_user, template_id)
