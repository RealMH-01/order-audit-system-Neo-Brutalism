"""统一的大模型客户端封装：Provider 归一化、文本与视觉调用、连接测试。"""

from __future__ import annotations

import asyncio
from typing import Any

from app.config import Settings
from app.errors import AppError
from app.models.schemas import FeatureStatus

try:
    from openai import OpenAI
except Exception:  # pragma: no cover
    OpenAI = None

try:
    from zhipuai import ZhipuAI
except Exception:  # pragma: no cover
    ZhipuAI = None


class LLMClientService:
    """统一封装 OpenAI、DeepSeek、智谱的调用入口。"""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def get_provider_features(self) -> list[FeatureStatus]:
        """返回当前模型客户端能力说明。"""

        return [
            FeatureStatus(
                name="统一文本调用入口",
                ready=True,
                note="已封装 OpenAI / DeepSeek / 智谱的统一文本调用逻辑。",
            ),
            FeatureStatus(
                name="统一视觉调用入口",
                ready=True,
                note="已封装 OpenAI / 智谱视觉消息拼装，DeepSeek 会明确拒绝视觉调用。",
            ),
        ]

    def _resolve_provider(self, provider: str | None, model: str | None = None) -> str:
        """把外部 provider / model 输入归一化到统一 provider 名称。"""

        if provider:
            normalized = provider.strip().lower()
        else:
            normalized = ""

        model_name = (model or "").strip().lower()
        if normalized in {"openai", "deepseek", "zhipuai"}:
            return normalized
        if normalized in {"zhipu", "glm"}:
            return "zhipuai"

        if model_name.startswith("deepseek"):
            return "deepseek"
        if model_name.startswith("glm"):
            return "zhipuai"
        if model_name.startswith("gpt") or model_name.startswith("o3"):
            return "openai"

        fallback = self.settings.default_llm_provider.strip().lower()
        if fallback in {"openai", "deepseek", "zhipuai"}:
            return fallback
        return "openai"

    def _resolve_model(
        self,
        *,
        provider: str,
        requested_model: str | None = None,
        deep_think: bool = False,
        vision: bool = False,
    ) -> str:
        """根据 provider 与场景选择默认模型。"""

        if requested_model:
            return requested_model

        if provider == "deepseek":
            return "deepseek-reasoner" if deep_think else "deepseek-chat"
        if provider == "zhipuai":
            return "glm-4v" if vision else "glm-4-flash"
        if vision:
            return self.settings.default_vision_model
        if deep_think:
            return self.settings.default_reasoning_model
        return self.settings.default_text_model

    async def call_llm(
        self,
        messages: list[dict[str, Any]],
        *,
        provider: str | None = None,
        requested_model: str | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
        deep_think: bool = False,
        temperature: float = 0.0,
    ) -> str:
        """统一文本调用入口。"""

        normalized_provider = self._resolve_provider(provider, requested_model)
        model = self._resolve_model(
            provider=normalized_provider,
            requested_model=requested_model,
            deep_think=deep_think,
            vision=False,
        )

        if normalized_provider in {"openai", "deepseek"}:
            return await self._call_openai_compatible(
                messages,
                provider=normalized_provider,
                model=model,
                api_key=api_key,
                base_url=base_url,
                temperature=temperature,
            )
        if normalized_provider == "zhipuai":
            return await self._call_zhipu_text(messages, model=model, api_key=api_key)
        raise AppError("不支持的模型提供方。", status_code=400)

    async def call_llm_with_image(
        self,
        messages: list[dict[str, Any]],
        image_payloads: list[str],
        *,
        provider: str | None = None,
        requested_model: str | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
        deep_think: bool = False,
        temperature: float = 0.0,
    ) -> str:
        """统一视觉调用入口。"""

        normalized_provider = self._resolve_provider(provider, requested_model)
        if normalized_provider == "deepseek":
            raise AppError("DeepSeek 当前不支持视觉/OCR 输入，请切换到 OpenAI 或智谱。", status_code=400)

        model = self._resolve_model(
            provider=normalized_provider,
            requested_model=requested_model,
            deep_think=deep_think,
            vision=True,
        )
        multimodal_messages = self._build_multimodal_messages(messages, image_payloads)

        if normalized_provider == "openai":
            return await self._call_openai_compatible(
                multimodal_messages,
                provider="openai",
                model=model,
                api_key=api_key,
                base_url=base_url,
                temperature=temperature,
            )
        if normalized_provider == "zhipuai":
            return await self._call_zhipu_text(multimodal_messages, model=model, api_key=api_key)

        raise AppError("当前视觉调用 provider 无法识别。", status_code=400)

    async def test_connection(
        self,
        *,
        provider: str | None = None,
        requested_model: str | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> dict[str, Any]:
        """做一次最小远程连接测试。"""

        response = await self.call_llm(
            [{"role": "user", "content": "Reply with OK only."}],
            provider=provider,
            requested_model=requested_model,
            api_key=api_key,
            base_url=base_url,
            deep_think=False,
            temperature=0.0,
        )
        return {
            "success": True,
            "message": "模型连接测试已返回响应。",
            "response_preview": response[:120],
        }

    async def _call_openai_compatible(
        self,
        messages: list[dict[str, Any]],
        *,
        provider: str,
        model: str,
        api_key: str | None,
        base_url: str | None,
        temperature: float,
    ) -> str:
        """调用 OpenAI 兼容接口，包括 OpenAI 和 DeepSeek。"""

        if OpenAI is None:
            raise AppError("当前环境缺少 openai SDK，暂时无法调用模型。", status_code=500)

        resolved_api_key = api_key or self._get_default_api_key(provider)
        if not resolved_api_key:
            raise AppError(f"{provider} API key 未配置，暂时无法执行模型调用。", status_code=400)

        resolved_base_url = base_url or self._get_default_base_url(provider)

        def _run() -> str:
            try:
                client = OpenAI(api_key=resolved_api_key, base_url=resolved_base_url or None)
                response = client.chat.completions.create(
                    model=model,
                    messages=messages,
                    temperature=temperature,
                )
                return response.choices[0].message.content or ""
            except Exception as exc:  # pragma: no cover
                raise self._map_exception(provider, exc) from exc

        return await asyncio.to_thread(_run)

    async def _call_zhipu_text(
        self,
        messages: list[dict[str, Any]],
        *,
        model: str,
        api_key: str | None,
    ) -> str:
        """调用智谱模型。"""

        if ZhipuAI is None:
            raise AppError("当前环境缺少 zhipuai SDK，暂时无法调用智谱模型。", status_code=500)

        resolved_api_key = api_key or self.settings.zhipuai_api_key
        if not resolved_api_key:
            raise AppError("智谱 API key 未配置，暂时无法执行模型调用。", status_code=400)

        def _run() -> str:
            try:
                client = ZhipuAI(api_key=resolved_api_key)
                response = client.chat.completions.create(model=model, messages=messages)
                return response.choices[0].message.content or ""
            except Exception as exc:  # pragma: no cover
                raise self._map_exception("zhipuai", exc) from exc

        return await asyncio.to_thread(_run)

    def _build_multimodal_messages(
        self,
        messages: list[dict[str, Any]],
        image_payloads: list[str],
    ) -> list[dict[str, Any]]:
        """把文本消息改造成包含图片的多模态消息。"""

        if not messages:
            return []

        transformed: list[dict[str, Any]] = []
        last_user_index = max((index for index, item in enumerate(messages) if item.get("role") == "user"), default=-1)
        for index, message in enumerate(messages):
            content = message.get("content", "")
            if index == last_user_index:
                multimodal_content: list[dict[str, Any]] = [{"type": "text", "text": str(content)}]
                multimodal_content.extend(
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{payload}"},
                    }
                    for payload in image_payloads
                    if payload
                )
                transformed.append({"role": message.get("role", "user"), "content": multimodal_content})
            else:
                transformed.append({"role": message.get("role", "user"), "content": str(content)})
        return transformed

    def _get_default_api_key(self, provider: str) -> str:
        """读取 provider 默认 API key。"""

        if provider == "openai":
            return self.settings.openai_api_key
        if provider == "deepseek":
            return self.settings.deepseek_api_key
        if provider == "zhipuai":
            return self.settings.zhipuai_api_key
        return ""

    def _get_default_base_url(self, provider: str) -> str:
        """读取 provider 默认 base URL。"""

        if provider == "deepseek":
            return self.settings.deepseek_base_url
        if provider == "openai":
            return self.settings.openai_base_url
        return ""

    @staticmethod
    def _map_exception(provider: str, exc: Exception) -> AppError:
        """把底层 SDK 异常映射成中文友好错误。"""

        message = str(exc)
        lowered = message.lower()
        if "401" in lowered or "unauthorized" in lowered or "invalid api key" in lowered:
            return AppError(f"{provider} 鉴权失败，请检查 API key 是否正确。", status_code=401)
        if "429" in lowered or "rate limit" in lowered:
            return AppError(f"{provider} 调用过于频繁，请稍后重试。", status_code=429)
        if "timeout" in lowered:
            return AppError(f"{provider} 请求超时，请稍后重试。", status_code=504)
        return AppError(f"{provider} 调用失败：{message}", status_code=502)
