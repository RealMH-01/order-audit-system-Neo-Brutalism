from fastapi import APIRouter, Depends

from app.dependencies import get_current_user, get_settings_service
from app.models.schemas import (
    ConnectionTestRequest,
    ConnectionTestResponse,
    CurrentUser,
    DisclaimerUpdateRequest,
    FeatureStatus,
    ProfileResponse,
    ProfileUpdateRequest,
    SettingsCapability,
)
from app.services.settings_service import SettingsService

router = APIRouter()


@router.get("/capabilities", response_model=SettingsCapability, summary="系统设置能力说明")
async def get_settings_capabilities() -> SettingsCapability:
    return SettingsCapability(
        sections=["profile", "keys", "connection-test", "disclaimer"],
        features=[
            FeatureStatus(
                name="profile 最小读写闭环",
                ready=True,
                note="已提供 profile 读取、更新、免责声明和连接测试接口。",
            ),
            FeatureStatus(
                name="明文密钥回传",
                ready=False,
                note="所有 API key 仅以 has_xxx_key 布尔标记返回。",
            ),
        ],
    )


@router.get("/profile", response_model=ProfileResponse)
async def get_profile(
    current_user: CurrentUser = Depends(get_current_user),
    service: SettingsService = Depends(get_settings_service),
) -> ProfileResponse:
    return service.get_profile(current_user)


@router.put("/profile", response_model=ProfileResponse)
async def update_profile(
    payload: ProfileUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
    service: SettingsService = Depends(get_settings_service),
) -> ProfileResponse:
    return service.update_profile(current_user, payload)


@router.put("/disclaimer", response_model=ProfileResponse)
async def update_disclaimer(
    payload: DisclaimerUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
    service: SettingsService = Depends(get_settings_service),
) -> ProfileResponse:
    return service.update_disclaimer(current_user, payload)


@router.post("/test-connection", response_model=ConnectionTestResponse)
async def test_connection(
    payload: ConnectionTestRequest,
    current_user: CurrentUser = Depends(get_current_user),
    service: SettingsService = Depends(get_settings_service),
) -> ConnectionTestResponse:
    return await service.test_connection(current_user, payload)
