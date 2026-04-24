"""Supabase client helpers, REST fallback, and API key encryption utilities."""

from __future__ import annotations

from functools import lru_cache
from typing import Any

import httpx

from app.config import Settings, get_settings
from app.errors import AppError

try:
    from supabase import Client as SupabaseClient
    from supabase import create_client
except Exception:  # pragma: no cover
    SupabaseClient = Any  # type: ignore[assignment]
    create_client = None


class EncryptionConfigurationError(RuntimeError):
    """Raised when local API key encryption cannot be performed safely."""


class ApiKeyCipher:
    """Encrypt and decrypt persisted provider API keys."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def is_configured(self) -> bool:
        return bool(self.settings.encryption_key)

    def encrypt(self, plain_text: str) -> str:
        if not plain_text:
            raise EncryptionConfigurationError("API key plaintext cannot be empty.")

        fernet = self._build_fernet()
        return fernet.encrypt(plain_text.encode("utf-8")).decode("utf-8")

    def decrypt(self, cipher_text: str) -> str:
        if not cipher_text:
            raise EncryptionConfigurationError("API key ciphertext cannot be empty.")

        fernet = self._build_fernet()
        try:
            return fernet.decrypt(cipher_text.encode("utf-8")).decode("utf-8")
        except Exception as exc:  # pragma: no cover
            raise EncryptionConfigurationError("API key decryption failed.") from exc

    def encrypt_profile_api_keys(self, raw_values: dict[str, str | None]) -> dict[str, str]:
        encrypted_payload: dict[str, str] = {}
        for field_name in (
            "deepseek_api_key",
            "zhipu_api_key",
            "zhipu_ocr_api_key",
            "openai_api_key",
        ):
            raw_value = raw_values.get(field_name)
            if raw_value:
                encrypted_payload[field_name] = self.encrypt(raw_value)
        return encrypted_payload

    def describe_usage(self) -> str:
        return (
            "Encrypt raw profile API key fields before saving them to Supabase, "
            "and only decrypt them on the server side after reading."
        )

    def _build_fernet(self):
        if not self.settings.encryption_key:
            raise EncryptionConfigurationError("ENCRYPTION_KEY is not configured.")

        try:
            from cryptography.fernet import Fernet
        except ImportError as exc:  # pragma: no cover
            raise EncryptionConfigurationError("cryptography is not installed.") from exc

        try:
            return Fernet(self.settings.encryption_key.encode("utf-8"))
        except Exception as exc:  # pragma: no cover
            raise EncryptionConfigurationError("ENCRYPTION_KEY is not a valid Fernet key.") from exc


class RestSupabaseResponse:
    """Minimal response object compatible with the repository expectations."""

    def __init__(self, data: Any) -> None:
        self.data = data


class RestSupabaseTable:
    """Very small PostgREST query builder used when supabase-py rejects secret keys."""

    def __init__(self, client: "RestSupabaseClient", table_name: str) -> None:
        self.client = client
        self.table_name = table_name
        self.method = "GET"
        self.params: dict[str, str] = {}
        self.headers: dict[str, str] = {}
        self.json_payload: Any = None
        self.order_parts: list[str] = []

    def select(self, columns: str) -> "RestSupabaseTable":
        self.method = "GET"
        self.params["select"] = columns
        return self

    def insert(self, payload: Any) -> "RestSupabaseTable":
        self.method = "POST"
        self.json_payload = payload
        self.headers["Prefer"] = "return=representation"
        return self

    def upsert(self, payload: Any, on_conflict: str | None = None) -> "RestSupabaseTable":
        self.method = "POST"
        self.json_payload = payload
        self.headers["Prefer"] = "resolution=merge-duplicates,return=representation"
        if on_conflict:
            self.params["on_conflict"] = on_conflict
        return self

    def update(self, payload: Any) -> "RestSupabaseTable":
        self.method = "PATCH"
        self.json_payload = payload
        self.headers["Prefer"] = "return=representation"
        return self

    def delete(self) -> "RestSupabaseTable":
        self.method = "DELETE"
        self.headers["Prefer"] = "return=representation"
        return self

    def eq(self, column: str, value: Any) -> "RestSupabaseTable":
        self.params[column] = f"eq.{self._format_filter_value(value)}"
        return self

    def limit(self, value: int) -> "RestSupabaseTable":
        self.params["limit"] = str(value)
        return self

    def order(self, column: str, desc: bool = False) -> "RestSupabaseTable":
        direction = "desc" if desc else "asc"
        self.order_parts.append(f"{column}.{direction}")
        self.params["order"] = ",".join(self.order_parts)
        return self

    def or_(self, expression: str) -> "RestSupabaseTable":
        self.params["or"] = f"({expression})"
        return self

    def execute(self) -> RestSupabaseResponse:
        data = self.client.request(
            self.method,
            f"/rest/v1/{self.table_name}",
            params=self.params,
            json_body=self.json_payload,
            extra_headers=self.headers,
        )
        return RestSupabaseResponse(data)

    @staticmethod
    def _format_filter_value(value: Any) -> str:
        if isinstance(value, bool):
            return str(value).lower()
        if value is None:
            return "null"
        return str(value)


class RestSupabaseClient:
    """HTTPX-based fallback client compatible with the repository usage in this project."""

    def __init__(self, settings: Settings, access_key: str) -> None:
        self.settings = settings
        self.access_key = access_key

    def table(self, table_name: str) -> RestSupabaseTable:
        return RestSupabaseTable(self, table_name)

    def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str] | None = None,
        json_body: Any = None,
        extra_headers: dict[str, str] | None = None,
    ) -> Any:
        return supabase_http_request(
            method,
            path,
            params=params,
            json_body=json_body,
            extra_headers=extra_headers,
            settings=self.settings,
            access_key=self.access_key,
        )


def supabase_http_request(
    method: str,
    path: str,
    *,
    params: dict[str, str] | None = None,
    json_body: Any = None,
    extra_headers: dict[str, str] | None = None,
    settings: Settings | None = None,
    access_key: str | None = None,
) -> Any:
    effective_settings = settings or get_settings()
    key = access_key or effective_settings.supabase_service_role_key
    if not effective_settings.supabase_url or not key:
        raise AppError("Supabase is not configured.", status_code=500)

    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
    }
    if json_body is not None:
        headers["Content-Type"] = "application/json"
    if extra_headers:
        headers.update(extra_headers)

    url = f"{effective_settings.supabase_url.rstrip('/')}{path}"
    response = httpx.request(
        method=method,
        url=url,
        headers=headers,
        params=params,
        json=json_body,
        timeout=30.0,
        trust_env=False,
    )
    if response.status_code >= 400:
        detail = response.text.strip() or response.reason_phrase
        raise AppError(f"Supabase request failed: {detail}", status_code=500)

    if not response.text.strip():
        return []
    return response.json()
@lru_cache
def get_supabase_client(use_service_role: bool = True) -> SupabaseClient | RestSupabaseClient | None:
    """Return the configured Supabase client, falling back to raw REST for secret keys."""

    settings = get_settings()
    access_key = settings.supabase_service_role_key if use_service_role else settings.supabase_anon_key
    if not settings.supabase_url or not access_key:
        return None

    if access_key.startswith("sb_"):
        return RestSupabaseClient(settings=settings, access_key=access_key)

    if create_client is None:
        return RestSupabaseClient(settings=settings, access_key=access_key)

    try:
        return create_client(settings.supabase_url, access_key)
    except Exception:
        return RestSupabaseClient(settings=settings, access_key=access_key)


def is_supabase_configured(settings: Settings | None = None) -> bool:
    effective_settings = settings or get_settings()
    return bool(effective_settings.supabase_url and effective_settings.supabase_service_role_key)


@lru_cache
def get_api_key_cipher() -> ApiKeyCipher:
    return ApiKeyCipher(settings=get_settings())
