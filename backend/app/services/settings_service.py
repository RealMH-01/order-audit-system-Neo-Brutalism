"""Profile and settings service with Supabase fallback orchestration."""

from __future__ import annotations

from datetime import datetime, timezone

from app.config import Settings
from app.db.repository import SupabaseRepository
from app.db.supabase_client import ApiKeyCipher
from app.errors import AppError
from app.models.schemas import (
    ConnectionTestRequest,
    ConnectionTestResponse,
    CurrentUser,
    DisclaimerUpdateRequest,
    ProfileResponse,
    ProfileUpdateRequest,
)
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
        repo: SupabaseRepository | None = None,
    ) -> None:
        self.settings = settings
        self.store = store
        self.cipher = cipher
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

    def test_connection(
        self,
        current_user: CurrentUser,
        payload: ConnectionTestRequest,
    ) -> ConnectionTestResponse:
        profile = self._get_profile_record(current_user.id)
        field_name = {
            "openai": "openai_api_key",
            "deepseek": "deepseek_api_key",
            "zhipuai": "zhipu_api_key",
            "zhipu-ocr": "zhipu_ocr_api_key",
        }[payload.provider]

        raw_key = payload.api_key
        if payload.use_saved_key and not raw_key:
            raw_key = profile.get(field_name)

        if not raw_key:
            raise AppError("No API key is available for this test.", status_code=400)

        return ConnectionTestResponse(
            success=True,
            message="Local validation passed. Remote provider connectivity is not checked in this round.",
        )

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
