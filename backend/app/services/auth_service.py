"""提供认证基础链路和当前用户读取能力。

Round 5 起，AuthService 以 Supabase Auth (GoTrue) 作为真源；当 Supabase Auth 不可用时
（例如本地开发未配置 SUPABASE_URL / SUPABASE_ANON_KEY），自动回退到 RuntimeStore
驱动的内存态闭环，保证前端接口协议不变。
"""

from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from app.config import Settings
from app.db.repository import SupabaseRepository
from app.db.supabase_client import (
    get_supabase_auth_client,
    is_supabase_auth_available,
)
from app.errors import AppError
from app.models.schemas import (
    AuthLoginRequest,
    AuthRegisterRequest,
    AuthTokenResponse,
    CurrentUser,
)
from app.services.runtime_store import RuntimeStore

logger = logging.getLogger(__name__)


class AuthService:
    """提供注册、登录和当前用户读取的最小闭环。"""

    def __init__(
        self,
        settings: Settings,
        store: RuntimeStore,
        repo: SupabaseRepository | None = None,
    ) -> None:
        self.settings = settings
        self.store = store
        self.repo = repo

    # ------------------------------------------------------------------
    # Mode dispatch
    # ------------------------------------------------------------------

    def _supabase_mode(self) -> bool:
        """True when both Supabase Auth credentials and the persistence repo are wired up."""

        return bool(is_supabase_auth_available(self.settings) and self.repo is not None)

    # ------------------------------------------------------------------
    # Register
    # ------------------------------------------------------------------

    def register(self, payload: AuthRegisterRequest) -> AuthTokenResponse:
        """注册用户并创建默认 profile。"""

        if self._supabase_mode():
            return self._register_supabase(payload)
        return self._register_fallback(payload)

    def _register_fallback(self, payload: AuthRegisterRequest) -> AuthTokenResponse:
        email = payload.email.lower()
        if email in self.store.user_ids_by_email:
            raise AppError("该邮箱已注册，请直接登录。", status_code=409)

        role = "admin" if not self.store.users_by_id else "user"
        password_hash = self._hash_password(payload.password)
        created_at = datetime.now(timezone.utc)
        user_id = str(uuid4())

        self.store.users_by_id[user_id] = {
            "id": user_id,
            "email": email,
            "password_hash": password_hash,
            "role": role,
            "created_at": created_at,
        }
        self.store.user_ids_by_email[email] = user_id

        profile = self._default_profile(
            user_id=user_id,
            display_name=payload.display_name,
            role=role,
            created_at=created_at,
        )
        self.store.profiles[user_id] = profile
        return self._issue_fallback_token(user_id)

    def _register_supabase(self, payload: AuthRegisterRequest) -> AuthTokenResponse:
        assert self.repo is not None  # guarded by _supabase_mode
        email = payload.email.lower()

        auth_client = get_supabase_auth_client()
        if auth_client is None:
            # Shouldn't happen given _supabase_mode, but guard defensively.
            return self._register_fallback(payload)

        try:
            sign_up_response = auth_client.auth.sign_up(
                {
                    "email": email,
                    "password": payload.password,
                    "options": {
                        "data": {"display_name": payload.display_name}
                        if payload.display_name
                        else {}
                    },
                }
            )
        except AppError:
            raise
        except Exception as exc:
            message = str(exc)
            lower_message = message.lower()
            if "already" in lower_message or "registered" in lower_message or "exists" in lower_message:
                raise AppError("该邮箱已注册，请直接登录。", status_code=409) from exc
            logger.warning("Supabase sign_up failed: %s", message)
            raise AppError("注册失败，请稍后重试。", status_code=400) from exc

        user = getattr(sign_up_response, "user", None)
        session = getattr(sign_up_response, "session", None)
        user_id = getattr(user, "id", None) if user is not None else None
        user_email = getattr(user, "email", None) if user is not None else None

        if not user_id:
            raise AppError("注册失败，请稍后重试。", status_code=400)

        access_token = getattr(session, "access_token", None) if session is not None else None
        if not access_token:
            raise AppError(
                "当前 Supabase 配置要求邮箱确认，注册后无法自动登录。请在 Supabase "
                "Dashboard 关闭 email confirmation 或手动确认邮箱后再登录。",
                status_code=422,
            )

        # Determine role: first profile ever → admin, otherwise regular user.
        role = self._determine_role_for_new_user(user_id)
        created_at = datetime.now(timezone.utc)
        profile_payload = self._default_profile(
            user_id=user_id,
            display_name=payload.display_name,
            role=role,
            created_at=created_at,
        )

        try:
            persisted_profile = self.repo.upsert_profile(user_id, profile_payload)
        except AppError as exc:
            logger.error("Profile upsert failed after Supabase sign_up: %s", exc.message)
            raise AppError(
                "注册成功但用户资料初始化失败，请联系管理员。",
                status_code=500,
            ) from exc
        except Exception as exc:
            logger.error("Unexpected profile upsert failure after Supabase sign_up: %s", exc)
            raise AppError(
                "注册成功但用户资料初始化失败，请联系管理员。",
                status_code=500,
            ) from exc

        # Cache into RuntimeStore so fallback code paths (e.g. read-after-write in tests)
        # can still resolve the user without another round-trip to Supabase.
        self.store.profiles[user_id] = persisted_profile
        self.store.user_ids_by_email[email] = user_id
        self.store.users_by_id[user_id] = {
            "id": user_id,
            "email": user_email or email,
            "password_hash": None,
            "role": persisted_profile.get("role", role),
            "created_at": created_at,
        }
        self.store.tokens[access_token] = user_id

        current_user = CurrentUser(
            id=user_id,
            email=user_email or email,
            display_name=persisted_profile.get("display_name"),
            role=persisted_profile.get("role", role),
        )
        return AuthTokenResponse(access_token=access_token, user=current_user)

    # ------------------------------------------------------------------
    # Login
    # ------------------------------------------------------------------

    def login(self, payload: AuthLoginRequest) -> AuthTokenResponse:
        """校验邮箱和密码并返回访问令牌。"""

        if self._supabase_mode():
            return self._login_supabase(payload)
        return self._login_fallback(payload)

    def _login_fallback(self, payload: AuthLoginRequest) -> AuthTokenResponse:
        email = payload.email.lower()
        user_id = self.store.user_ids_by_email.get(email)
        if not user_id:
            raise AppError("账号或密码错误。", status_code=401)

        user_record = self.store.users_by_id[user_id]
        if user_record.get("password_hash") != self._hash_password(payload.password):
            raise AppError("账号或密码错误。", status_code=401)

        return self._issue_fallback_token(user_id)

    def _login_supabase(self, payload: AuthLoginRequest) -> AuthTokenResponse:
        assert self.repo is not None

        auth_client = get_supabase_auth_client()
        if auth_client is None:
            return self._login_fallback(payload)

        email = payload.email.lower()
        try:
            response = auth_client.auth.sign_in_with_password(
                {"email": email, "password": payload.password}
            )
        except AppError as exc:
            # GoTrue 400 = invalid credentials; normalise to 401 for the frontend.
            if exc.status_code in (400, 401):
                raise AppError("账号或密码错误。", status_code=401) from exc
            raise
        except Exception as exc:
            logger.warning("Supabase sign_in_with_password failed: %s", exc)
            raise AppError("账号或密码错误。", status_code=401) from exc

        user = getattr(response, "user", None)
        session = getattr(response, "session", None)
        user_id = getattr(user, "id", None) if user is not None else None
        user_email = getattr(user, "email", None) if user is not None else None
        access_token = getattr(session, "access_token", None) if session is not None else None

        if not user_id or not access_token:
            raise AppError("账号或密码错误。", status_code=401)

        profile = self._load_or_create_profile(
            user_id=user_id,
            email=user_email or email,
        )

        # Refresh caches
        self.store.profiles[user_id] = profile
        self.store.user_ids_by_email[email] = user_id
        self.store.users_by_id[user_id] = {
            "id": user_id,
            "email": user_email or email,
            "password_hash": None,
            "role": profile.get("role", "user"),
            "created_at": profile.get("created_at"),
        }
        self.store.tokens[access_token] = user_id

        current_user = CurrentUser(
            id=user_id,
            email=user_email or email,
            display_name=profile.get("display_name"),
            role=profile.get("role", "user"),
        )
        return AuthTokenResponse(access_token=access_token, user=current_user)

    # ------------------------------------------------------------------
    # Current user
    # ------------------------------------------------------------------

    def get_current_user(self, token: str) -> CurrentUser:
        """根据 bearer token 获取当前用户。"""

        if not token:
            raise AppError("登录状态已失效，请重新登录。", status_code=401)

        if self._supabase_mode():
            return self._get_current_user_supabase(token)
        return self._get_current_user_fallback(token)

    def _get_current_user_fallback(self, token: str) -> CurrentUser:
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

    def _get_current_user_supabase(self, token: str) -> CurrentUser:
        assert self.repo is not None

        auth_client = get_supabase_auth_client()
        if auth_client is None:
            return self._get_current_user_fallback(token)

        try:
            response = auth_client.auth.get_user(token)
        except AppError:
            raise AppError("登录状态已失效，请重新登录。", status_code=401)
        except Exception as exc:
            logger.warning("Supabase auth.get_user failed: %s", exc)
            raise AppError("登录状态已失效，请重新登录。", status_code=401) from exc

        user = getattr(response, "user", None) if response is not None else None
        user_id = getattr(user, "id", None) if user is not None else None
        user_email = getattr(user, "email", None) if user is not None else None

        if not user_id:
            raise AppError("登录状态已失效，请重新登录。", status_code=401)

        profile = self._load_or_create_profile(user_id=user_id, email=user_email or "")

        # Cache for cross-service compatibility
        self.store.profiles[user_id] = profile
        if user_email:
            self.store.user_ids_by_email[user_email.lower()] = user_id
        self.store.users_by_id[user_id] = {
            "id": user_id,
            "email": user_email or self.store.users_by_id.get(user_id, {}).get("email", ""),
            "password_hash": None,
            "role": profile.get("role", "user"),
            "created_at": profile.get("created_at"),
        }
        self.store.tokens[token] = user_id

        return CurrentUser(
            id=user_id,
            email=user_email or self.store.users_by_id[user_id]["email"],
            display_name=profile.get("display_name"),
            role=profile.get("role", "user"),
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _default_profile(
        self,
        *,
        user_id: str,
        display_name: str | None,
        role: str,
        created_at: datetime,
    ) -> dict[str, Any]:
        return {
            "id": user_id,
            "display_name": display_name,
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

    def _determine_role_for_new_user(self, user_id: str) -> str:
        """Query profiles to decide whether this user should be bootstrapped as admin.

        A user is treated as admin when no other profile rows exist yet. We tolerate
        read failures by defaulting to 'user' — the SQL trigger (migration 001) provides
        an additional safety net if it has been applied in the project.
        """

        if self.repo is None:
            return "user"
        try:
            existing = self.repo.get_profile(user_id)
            if existing is not None:
                # A profile row already exists (e.g. created by the auth trigger); respect it.
                existing_role = existing.get("role")
                if existing_role in ("user", "admin"):
                    return existing_role
            # Probe: list templates is too expensive; use a direct select against profiles.
            client = getattr(self.repo, "client", None)
            if client is not None:
                result = client.table("profiles").select("id").limit(1).execute()
                rows = getattr(result, "data", None) or []
                if not rows:
                    return "admin"
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("Unable to determine role for new user, defaulting to 'user': %s", exc)
        return "user"

    def _load_or_create_profile(self, *, user_id: str, email: str) -> dict[str, Any]:
        assert self.repo is not None
        try:
            profile = self.repo.get_profile(user_id)
        except AppError as exc:
            logger.warning("Profile read failed for user %s: %s", user_id, exc.message)
            profile = None
        except Exception as exc:
            logger.warning("Unexpected profile read failure for user %s: %s", user_id, exc)
            profile = None

        if profile is not None:
            return profile

        created_at = datetime.now(timezone.utc)
        default_payload = self._default_profile(
            user_id=user_id,
            display_name=None,
            role=self._determine_role_for_new_user(user_id),
            created_at=created_at,
        )
        try:
            return self.repo.upsert_profile(user_id, default_payload)
        except Exception as exc:
            logger.error("Auto profile bootstrap failed for user %s: %s", user_id, exc)
            raise AppError(
                "用户资料初始化失败，请稍后重试或联系管理员。",
                status_code=500,
            ) from exc

    def _issue_fallback_token(self, user_id: str) -> AuthTokenResponse:
        token = secrets.token_urlsafe(24)
        self.store.tokens[token] = user_id
        return AuthTokenResponse(
            access_token=token,
            user=self._get_current_user_fallback(token),
        )

    @staticmethod
    def _hash_password(password: str) -> str:
        return hashlib.sha256(password.encode("utf-8")).hexdigest()
