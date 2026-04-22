"""提供认证基础链路和当前用户读取能力。"""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timezone
from uuid import uuid4

from app.config import Settings
from app.errors import AppError
from app.models.schemas import (
    AuthLoginRequest,
    AuthRegisterRequest,
    AuthTokenResponse,
    CurrentUser,
)
from app.services.runtime_store import RuntimeStore


class AuthService:
    """提供注册、登录和当前用户读取的最小闭环。"""

    def __init__(self, settings: Settings, store: RuntimeStore) -> None:
        self.settings = settings
        self.store = store

    def register(self, payload: AuthRegisterRequest) -> AuthTokenResponse:
        """注册用户并创建默认 profile。"""

        email = payload.email.lower()
        if email in self.store.user_ids_by_email:
            raise AppError("该邮箱已注册，请直接登录。", status_code=409)

        user_id = str(uuid4())
        role = "admin" if not self.store.users_by_id else "user"
        created_at = datetime.now(timezone.utc)
        self.store.users_by_id[user_id] = {
            "id": user_id,
            "email": email,
            "password_hash": self._hash_password(payload.password),
            "role": role,
            "created_at": created_at,
        }
        self.store.user_ids_by_email[email] = user_id
        self.store.profiles[user_id] = {
            "id": user_id,
            "display_name": payload.display_name,
            "selected_model": self.settings.default_text_model,
            "deepseek_api_key": None,
            "zhipu_api_key": None,
            "zhipu_ocr_api_key": None,
            "openai_api_key": None,
            "deep_think_enabled": False,
            "company_affiliates": [],
            "company_affiliates_roles": [],
            "active_custom_rules": [],
            "wizard_completed": False,
            "disclaimer_accepted": False,
            "role": role,
            "created_at": created_at,
            "updated_at": created_at,
        }
        return self._issue_token(user_id)

    def login(self, payload: AuthLoginRequest) -> AuthTokenResponse:
        """校验邮箱和密码并返回访问令牌。"""

        email = payload.email.lower()
        user_id = self.store.user_ids_by_email.get(email)
        if not user_id:
            raise AppError("账号或密码错误。", status_code=401)

        user_record = self.store.users_by_id[user_id]
        if user_record["password_hash"] != self._hash_password(payload.password):
            raise AppError("账号或密码错误。", status_code=401)

        return self._issue_token(user_id)

    def get_current_user(self, token: str) -> CurrentUser:
        """根据 bearer token 获取当前用户。"""

        user_id = self.store.tokens.get(token)
        if not user_id:
            raise AppError("登录状态已失效，请重新登录。", status_code=401)

        user_record = self.store.users_by_id.get(user_id)
        profile_record = self.store.profiles.get(user_id)
        if not user_record or not profile_record:
            raise AppError("当前用户不存在或资料未初始化。", status_code=401)

        return CurrentUser(
            id=user_id,
            email=user_record["email"],
            display_name=profile_record.get("display_name"),
            role=profile_record.get("role", "user"),
        )

    def _issue_token(self, user_id: str) -> AuthTokenResponse:
        token = secrets.token_urlsafe(24)
        self.store.tokens[token] = user_id
        return AuthTokenResponse(access_token=token, user=self.get_current_user(token))

    @staticmethod
    def _hash_password(password: str) -> str:
        return hashlib.sha256(password.encode("utf-8")).hexdigest()
