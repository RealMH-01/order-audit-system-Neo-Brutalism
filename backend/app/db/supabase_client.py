"""提供 Supabase 客户端获取逻辑，以及 API key 加密存储的基础准备层。"""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from app.config import Settings, get_settings

try:
    from supabase import Client as SupabaseClient
    from supabase import create_client
except Exception:  # pragma: no cover
    SupabaseClient = Any  # type: ignore[assignment]
    create_client = None


class EncryptionConfigurationError(RuntimeError):
    """加密配置不完整或运行环境缺少必要组件。"""


class ApiKeyCipher:
    """
    为后续 profile/settings 写入提供 API key 加密与解密能力。

    数据库存储仍沿用原始字段名：
    - openai_api_key
    - deepseek_api_key
    - zhipu_api_key
    - zhipu_ocr_api_key

    这些字段将保存密文，而不是明文。
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def is_configured(self) -> bool:
        """判断是否具备执行加密的基础配置。"""

        return bool(self.settings.encryption_key)

    def encrypt(self, plain_text: str) -> str:
        """加密 API key，用于写入数据库原始字段名对应的密文字段值。"""

        if not plain_text:
            raise EncryptionConfigurationError("待加密的 API key 不能为空。")

        fernet = self._build_fernet()
        token = fernet.encrypt(plain_text.encode("utf-8"))
        return token.decode("utf-8")

    def decrypt(self, cipher_text: str) -> str:
        """解密 API key，仅允许服务端内部调用。"""

        if not cipher_text:
            raise EncryptionConfigurationError("待解密的密文不能为空。")

        fernet = self._build_fernet()
        try:
            plain_text = fernet.decrypt(cipher_text.encode("utf-8"))
        except Exception as exc:  # pragma: no cover
            raise EncryptionConfigurationError("API key 解密失败，请检查密钥配置是否正确。") from exc
        return plain_text.decode("utf-8")

    def encrypt_profile_api_keys(self, raw_values: dict[str, str | None]) -> dict[str, str]:
        """将 profile 写入载荷中的 API key 字段转换为密文。"""

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
        """返回后续 settings/profile 写入时的推荐用法说明。"""

        return (
            "在 settings/profile 写入 API key 前，先对原始字段值调用 "
            "ApiKeyCipher.encrypt_profile_api_keys()，再将返回的密文写入 "
            "profiles 表中的 deepseek_api_key、zhipu_api_key、zhipu_ocr_api_key "
            "和 openai_api_key；读取时仅允许服务端解密。"
        )

    def _build_fernet(self):
        if not self.settings.encryption_key:
            raise EncryptionConfigurationError("缺少 ENCRYPTION_KEY，暂时不能安全存储 API key。")

        try:
            from cryptography.fernet import Fernet
        except ImportError as exc:  # pragma: no cover
            raise EncryptionConfigurationError("缺少 cryptography 依赖，无法执行 API key 加密。") from exc

        try:
            return Fernet(self.settings.encryption_key.encode("utf-8"))
        except Exception as exc:  # pragma: no cover
            raise EncryptionConfigurationError("ENCRYPTION_KEY 格式无效，应为 Fernet 兼容密钥。") from exc


@lru_cache
def get_supabase_client(use_service_role: bool = True) -> SupabaseClient | None:
    """根据配置创建 Supabase 客户端；缺少配置时返回 None。"""

    settings = get_settings()
    if create_client is None:
        return None

    access_key = (
        settings.supabase_service_role_key if use_service_role else settings.supabase_anon_key
    )
    if not settings.supabase_url or not access_key:
        return None
    return create_client(settings.supabase_url, access_key)


def is_supabase_configured(settings: Settings | None = None) -> bool:
    """用于初始化脚本和运行检查的轻量配置判断。"""

    effective_settings = settings or get_settings()
    return bool(effective_settings.supabase_url and effective_settings.supabase_service_role_key)


@lru_cache
def get_api_key_cipher() -> ApiKeyCipher:
    """返回全局复用的 API key 加密工具实例。"""

    return ApiKeyCipher(settings=get_settings())
