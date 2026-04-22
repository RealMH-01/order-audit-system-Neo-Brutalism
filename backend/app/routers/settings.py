from fastapi import APIRouter

from app.config import get_settings
from app.models.schemas import FeatureStatus, SettingsCapability

router = APIRouter()


@router.get("/capabilities", response_model=SettingsCapability, summary="系统设置能力说明")
async def get_settings_capabilities() -> SettingsCapability:
    settings = get_settings()
    return SettingsCapability(
        sections=["models", "keys", "industry-templates", "rules"],
        features=[
            FeatureStatus(
                name="模型配置读取",
                ready=True,
                note=f"默认平台为 {settings.default_llm_provider}，当前只读取环境配置。",
            ),
            FeatureStatus(
                name="系统偏好管理",
                ready=False,
                note="具体设置存储与权限控制将在后续轮次接入。",
            ),
        ],
    )

