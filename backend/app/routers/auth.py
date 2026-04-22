from fastapi import APIRouter

from app.db.supabase_client import get_supabase_client
from app.models.schemas import AuthCapability, FeatureStatus

router = APIRouter()


@router.get("/capabilities", response_model=AuthCapability, summary="认证能力说明")
async def get_auth_capabilities() -> AuthCapability:
    return AuthCapability(
        provider="supabase-auth",
        features=[
            FeatureStatus(
                name="邮箱密码认证",
                ready=False,
                note="本轮只保留认证模块边界，真实注册登录流程后续接入。",
            ),
            FeatureStatus(
                name="Supabase 连接占位",
                ready=get_supabase_client() is not None,
                note="已预留客户端初始化位置，但未实现真实鉴权链路。",
            ),
        ],
    )

