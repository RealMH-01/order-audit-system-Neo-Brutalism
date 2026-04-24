"""Profile and settings service with Supabase fallback orchestration."""

from __future__ import annotations

from datetime import datetime, timezone

from app.config import Settings
from app.db.repository import SupabaseRepository
from app.db.supabase_client import ApiKeyCipher, EncryptionConfigurationError
from app.errors import AppError
from app.models.schemas import (
    ConnectionTestRequest,
    ConnectionTestResponse,
    CurrentUser,
    DisclaimerUpdateRequest,
    ProfileResponse,
    ProfileUpdateRequest,
)
from app.services.llm_client import LLMClientService
from app.services.runtime_store import RuntimeStore

API_KEY_FIELDS = (
    "deepseek_api_key",
    "zhipu_api_key",
    "zhipu_ocr_api_key",
    "openai_api_key",
)


class SettingsService:
    """Manage profile reads and writes while keeping RuntimeStore fallback."""

    def __init__(
        self,
        settings: Settings,
        store: RuntimeStore,
        cipher: ApiKeyCipher,
        llm_client: LLMClientService | None = None,
        repo: SupabaseRepository | None = None,
    ) -> None:
        self.settings = settings
        self.store = store
        self.cipher = cipher
        self.llm_client = llm_client
        self.repo = repo

    def get_profile(self, current_user: CurrentUser) -> ProfileResponse:
        profile = self._get_profile_record(current_user.id)
        return self._to_profile_response(profile)

    def update_profile(
        self,
        current_user: CurrentUser,
        payload: ProfileUpdateRequest,
    ) -> ProfileResponse:
        profile = self._get_profile_record(current_user.id)
        updates = payload.model_dump(exclude_unset=True)
        api_key_fields = {
            field_name: updates.pop(field_name)
            for field_name in API_KEY_FIELDS
            if field_name in updates
        }

        for field_name, field_value in updates.items():
            profile[field_name] = field_value

        if api_key_fields:
            self._apply_api_key_updates(profile, api_key_fields)

        profile["updated_at"] = datetime.now(timezone.utc)
        if self.repo is not None:
            profile = self.repo.update_profile(current_user.id, profile)
            self.store.profiles[current_user.id] = profile
        else:
            profile = self._save_profile(current_user.id, profile)
        return self._to_profile_response(profile)

    def update_disclaimer(
        self,
        current_user: CurrentUser,
        payload: DisclaimerUpdateRequest,
    ) -> ProfileResponse:
        if self.repo is not None:
            profile = self.repo.set_disclaimer_accepted(
                current_user.id,
                payload.disclaimer_accepted,
            )
            self.store.profiles[current_user.id] = profile
            return self._to_profile_response(profile)

        profile = self._get_profile_record(current_user.id)
        profile["disclaimer_accepted"] = payload.disclaimer_accepted
        profile["updated_at"] = datetime.now(timezone.utc)
        profile = self._save_profile(current_user.id, profile)
        return self._to_profile_response(profile)

    async def test_connection(
        self,
        current_user: CurrentUser,
        payload: ConnectionTestRequest,
    ) -> ConnectionTestResponse:
        """向远端 LLM 发送一次最小连接测试请求。"""

        profile = self._get_profile_record(current_user.id)

        field_name = {
            "openai": "openai_api_key",
            "deepseek": "deepseek_api_key",
            "zhipuai": "zhipu_api_key",
            "zhipu-ocr": "zhipu_ocr_api_key",
        }[payload.provider]

        # 优先使用本次请求中传入的临时 key；否则回退到用户已保存密钥（需要解密）。
        temporary_key = (payload.api_key or "").strip() or None
        raw_key: str | None = temporary_key
        if raw_key is None:
            stored_value = profile.get(field_name)
            if stored_value:
                raw_key = self._decrypt_stored_key(str(stored_value))

        if not raw_key:
            return ConnectionTestResponse(
                success=False,
                message="当前没有可用的 API key：请先在本页输入临时 key，或在保存密钥后再进行测试。",
            )

        if self.llm_client is None:
            # 理论上不会发生：依赖注入已经保证 llm_client 存在。保留一个防御式分支。
            return ConnectionTestResponse(
                success=False,
                message="LLM 客户端未注入，无法执行远程连接测试。",
            )

        # 把 settings 页面的 provider 语义映射到 LLMClient 的 provider 语义。
        # zhipu-ocr 仅是密钥分类，底层仍然走 zhipuai。
        llm_provider = "zhipuai" if payload.provider == "zhipu-ocr" else payload.provider
        requested_model = (payload.model or "").strip() or None

        try:
            result = await self.llm_client.test_connection(
                provider=llm_provider,
                requested_model=requested_model,
                api_key=raw_key,
            )
        except AppError as exc:
            # LLMClient 已经把常见错误映射成中文文案，这里直接回前端即可。
            return ConnectionTestResponse(
                success=False,
                message=self._sanitize_message(exc.message, raw_key),
            )
        except Exception as exc:  # pragma: no cover - 兜底，绝大多数异常已在 LLMClient 映射
            return ConnectionTestResponse(
                success=False,
                message=self._sanitize_message(f"远程连接测试失败：{exc}", raw_key),
            )

        response_preview = result.get("response_preview") if isinstance(result, dict) else None
        message = (
            result.get("message")
            if isinstance(result, dict) and result.get("message")
            else "模型连接测试已返回响应。"
        )
        success = bool(result.get("success", True)) if isinstance(result, dict) else True

        return ConnectionTestResponse(
            success=success,
            message=message,
            response_preview=response_preview,
        )

    def _decrypt_stored_key(self, stored_value: str) -> str:
        """尽量解密用户保存的 API key；解密失败时不要崩溃。"""

        if not self.cipher.is_configured():
            return stored_value
        try:
            return self.cipher.decrypt(stored_value)
        except EncryptionConfigurationError:
            return stored_value
        except Exception:
            # 加解密失败一般是历史数据格式问题，不能因此让用户无法测试连接。
            return stored_value

    @staticmethod
    def _sanitize_message(message: str, api_key: str | None) -> str:
        """防止在错误信息里回显完整 API key。"""

        if not api_key or not message:
            return message
        if api_key in message:
            return message.replace(api_key, "***")
        return message

    def _apply_api_key_updates(
        self,
        profile: dict[str, object],
        updates: dict[str, str | None],
    ) -> None:
        non_empty_values = {key: value for key, value in updates.items() if value not in (None, "")}
        if non_empty_values and not self.cipher.is_configured():
            raise AppError("ENCRYPTION_KEY is required before storing API keys.", status_code=500)

        if non_empty_values:
            encrypted = self.cipher.encrypt_profile_api_keys(non_empty_values)
            for field_name, cipher_text in encrypted.items():
                profile[field_name] = cipher_text

        for field_name, field_value in updates.items():
            if field_value == "":
                profile[field_name] = None

    def _get_profile_record(self, user_id: str) -> dict[str, object]:
        if self.repo is not None:
            profile = self.repo.get_profile(user_id)
            if profile is not None:
                self.store.profiles[user_id] = profile
                return profile

        profile = self.store.profiles.get(user_id)
        if not profile:
            raise AppError("Current user profile was not found.", status_code=404)
        return profile

    def _save_profile(self, user_id: str, profile: dict[str, object]) -> dict[str, object]:
        if self.repo is not None:
            if self.repo.get_profile(user_id) is None:
                profile = self.repo.upsert_profile(user_id, profile)
            else:
                profile = self.repo.update_profile(user_id, profile)
        self.store.profiles[user_id] = profile
        return profile

    @staticmethod
    def _to_profile_response(profile: dict[str, object]) -> ProfileResponse:
        return ProfileResponse(
            id=str(profile["id"]),
            display_name=profile.get("display_name"),
            selected_model=str(profile.get("selected_model", "gpt-4o")),
            deep_think_enabled=bool(profile.get("deep_think_enabled", False)),
            company_affiliates=list(profile.get("company_affiliates", [])),
            company_affiliates_roles=list(profile.get("company_affiliates_roles", [])),
            active_custom_rules=list(profile.get("active_custom_rules", [])),
            wizard_completed=bool(profile.get("wizard_completed", False)),
            disclaimer_accepted=bool(profile.get("disclaimer_accepted", False)),
            role=str(profile.get("role", "user")),  # type: ignore[arg-type]
            has_deepseek_key=bool(profile.get("deepseek_api_key")),
            has_zhipu_key=bool(profile.get("zhipu_api_key")),
            has_zhipu_ocr_key=bool(profile.get("zhipu_ocr_api_key")),
            has_openai_key=bool(profile.get("openai_api_key")),
            created_at=profile.get("created_at"),  # type: ignore[arg-type]
            updated_at=profile.get("updated_at"),  # type: ignore[arg-type]
        )
