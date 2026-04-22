from fastapi import APIRouter

from app.config import get_settings
from app.models.schemas import HealthStatus

router = APIRouter()


@router.get("/health", response_model=HealthStatus, summary="健康检查")
async def get_health_status() -> HealthStatus:
    settings = get_settings()
    return HealthStatus(
        status="ok",
        service=settings.app_name,
        version=settings.app_version,
        environment=settings.app_env,
    )


@router.get("/health/ready", response_model=HealthStatus, summary="就绪检查")
async def get_readiness_status() -> HealthStatus:
    settings = get_settings()
    return HealthStatus(
        status="ready",
        service=settings.app_name,
        version=settings.app_version,
        environment=settings.app_env,
    )
