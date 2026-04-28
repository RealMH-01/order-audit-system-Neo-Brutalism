from fastapi import APIRouter, Depends, Query

from app.dependencies import get_announcements_service, get_current_user, require_admin
from app.models.schemas import (
    AnnouncementAdminResponse,
    AnnouncementCreateRequest,
    AnnouncementPublicResponse,
    AnnouncementUpdateRequest,
    CurrentUser,
)
from app.services.announcements import AnnouncementService

router = APIRouter()


@router.get("/announcements", response_model=list[AnnouncementPublicResponse])
async def list_published_announcements(
    _: CurrentUser = Depends(get_current_user),
    service: AnnouncementService = Depends(get_announcements_service),
    limit: int = Query(default=50, ge=1, le=100),
) -> list[AnnouncementPublicResponse]:
    return service.list_published_announcements(limit=limit)


@router.get("/admin/announcements", response_model=list[AnnouncementAdminResponse])
async def list_admin_announcements(
    _: CurrentUser = Depends(require_admin),
    service: AnnouncementService = Depends(get_announcements_service),
    limit: int = Query(default=100, ge=1, le=200),
) -> list[AnnouncementAdminResponse]:
    return service.list_admin_announcements(limit=limit)


@router.post("/admin/announcements", response_model=AnnouncementAdminResponse)
async def create_admin_announcement(
    payload: AnnouncementCreateRequest,
    current_user: CurrentUser = Depends(require_admin),
    service: AnnouncementService = Depends(get_announcements_service),
) -> AnnouncementAdminResponse:
    return service.create_announcement(current_user, payload)


@router.patch("/admin/announcements/{announcement_id}", response_model=AnnouncementAdminResponse)
async def update_admin_announcement(
    announcement_id: str,
    payload: AnnouncementUpdateRequest,
    current_user: CurrentUser = Depends(require_admin),
    service: AnnouncementService = Depends(get_announcements_service),
) -> AnnouncementAdminResponse:
    return service.update_announcement(current_user, announcement_id, payload)
