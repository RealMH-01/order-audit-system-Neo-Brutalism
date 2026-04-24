from fastapi import APIRouter, Depends

from app.db.supabase_client import is_supabase_auth_available
from app.dependencies import get_auth_service, get_current_user
from app.models.schemas import (
    AuthCapability,
    AuthLoginRequest,
    AuthRegisterRequest,
    AuthTokenResponse,
    CurrentUser,
    FeatureStatus,
)
from app.services.auth_service import AuthService

router = APIRouter()


@router.get("/capabilities", response_model=AuthCapability, summary="认证能力说明")
async def get_auth_capabilities() -> AuthCapability:
    if is_supabase_auth_available():
        return AuthCapability(
            provider="supabase-auth",
            features=[
                FeatureStatus(
                    name="注册 / 登录 / 当前用户",
                    ready=True,
                    note="已接入 Supabase Auth，profile 与 auth.users 对齐。",
                ),
                FeatureStatus(
                    name="远程 Supabase 联调",
                    ready=True,
                    note="Supabase Auth 已接入，token 由 GoTrue 签发并校验。",
                ),
            ],
        )

    return AuthCapability(
        provider="supabase-auth-compatible",
        features=[
            FeatureStatus(
                name="注册 / 登录 / 当前用户",
                ready=True,
                note="已接入最小认证主链路，当前默认走内存态闭环。",
            ),
            FeatureStatus(
                name="远程 Supabase 联调",
                ready=False,
                note="未检测到 Supabase Auth 配置，系统已回退到 RuntimeStore 开发模式。",
            ),
        ],
    )


@router.post("/register", response_model=AuthTokenResponse)
async def register(
    payload: AuthRegisterRequest,
    service: AuthService = Depends(get_auth_service),
) -> AuthTokenResponse:
    return service.register(payload)


@router.post("/login", response_model=AuthTokenResponse)
async def login(
    payload: AuthLoginRequest,
    service: AuthService = Depends(get_auth_service),
) -> AuthTokenResponse:
    return service.login(payload)


@router.get("/me", response_model=CurrentUser)
async def get_me(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    return current_user
