from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_env: Literal["development", "staging", "production"] = "development"
    app_name: str = "Order Audit System API"
    app_version: str = "0.2.0"
    api_v1_prefix: str = "/api/v1"
    debug: bool = True
    allowed_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])

    supabase_url: str = ""
    supabase_service_role_key: str = ""
    supabase_anon_key: str = ""
    encryption_key: str = ""

    openai_api_key: str = ""
    openai_base_url: str = ""
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    zhipuai_api_key: str = ""

    default_llm_provider: str = "openai"
    default_text_model: str = "gpt-4o"
    default_reasoning_model: str = "o3-mini"
    default_vision_model: str = "gpt-4o"

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def split_allowed_origins(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
