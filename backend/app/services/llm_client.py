"""统一的大模型客户端封装：Provider 归一化、文本与视觉调用、连接测试。"""

from __future__ import annotations

import asyncio
from typing import Any, Awaitable

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

    # 连接测试默认超时（秒），不影响正式审核链路的超时策略。
    _CONNECTION_TEST_TIMEOUT_SECONDS = 20.0
    # 同步 SDK 调用会被放进线程池，外层必须限制单次等待时长，避免取消后长期占住审核链路。
    _DEFAULT_CALL_TIMEOUT_SECONDS = 120.0

    # DeepSeek 旧模型名 -> V4 新模型名的兼容映射。
    # 放在 _resolve_model 里使用，避免影响 _resolve_provider 的模型名前缀判断。
    _DEEPSEEK_LEGACY_MODEL_MAP = {
        "deepseek-chat": "deepseek-v4-flash",
        "deepseek-reasoner": "deepseek-v4-pro",
    }
    _ZHIPU_LEGACY_MODEL_MAP = {
        "glm-4v": "glm-4.6v",
        "glm-4-flash": "glm-4.6v-flash",
    }

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

        if provider == "deepseek":
            normalized_request = (requested_model or "").strip().lower()
            # DeepSeek 开启深度思考时统一使用 V4 Pro，避免沿用普通审核的 V4 Flash。
            if deep_think and normalized_request in {
                "",
                "deepseek-chat",
                "deepseek-v4-flash",
                "deepseek-reasoner",
            }:
                return "deepseek-v4-pro"

        if requested_model:
            normalized_request = requested_model.strip().lower()
            # DeepSeek 兼容：旧模型名 deepseek-chat / deepseek-reasoner 自动映射到 V4。
            # 仅对 DeepSeek provider 做归一化，避免把 OpenAI / Zhipu 模型误伤。
            if provider == "deepseek" and normalized_request in self._DEEPSEEK_LEGACY_MODEL_MAP:
                return self._DEEPSEEK_LEGACY_MODEL_MAP[normalized_request]
            if provider == "zhipuai" and normalized_request in self._ZHIPU_LEGACY_MODEL_MAP:
                return self._ZHIPU_LEGACY_MODEL_MAP[normalized_request]
            return requested_model

        if provider == "deepseek":
            # 非深度思考 -> V4 Flash；深度思考 / reasoner 场景 -> V4 Pro。
            return "deepseek-v4-pro" if deep_think else "deepseek-v4-flash"
        if provider == "zhipuai":
            return "glm-4.6v"
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
        timeout: float | None = None,
    ) -> str:
        """统一文本调用入口。"""

        normalized_provider = self._resolve_provider(provider, requested_model)
        model = self._resolve_model(
            provider=normalized_provider,
            requested_model=requested_model,
            deep_think=deep_think,
            vision=False,
        )
        effective_timeout = self._resolve_call_timeout(timeout)

        if normalized_provider in {"openai", "deepseek"}:
            # 同步 SDK 不会响应 asyncio 取消；这里统一加 wait_for，保证单次 LLM 调用最多等待指定时长。
            return await self._run_with_call_timeout(
                self._call_openai_compatible(
                    messages,
                    provider=normalized_provider,
                    model=model,
                    api_key=api_key,
                    base_url=base_url,
                    temperature=temperature,
                    request_timeout=effective_timeout,
                ),
                provider=normalized_provider,
                timeout=effective_timeout,
            )
        if normalized_provider == "zhipuai":
            # 同步 SDK 不会响应 asyncio 取消；这里统一加 wait_for，保证单次 LLM 调用最多等待指定时长。
            return await self._run_with_call_timeout(
                self._call_zhipu_text(
                    messages,
                    model=model,
                    api_key=api_key,
                    deep_think=deep_think,
                ),
                provider=normalized_provider,
                timeout=effective_timeout,
            )
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
        timeout: float | None = None,
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
        effective_timeout = self._resolve_call_timeout(timeout)

        if normalized_provider == "openai":
            # 视觉/OCR 单次请求通常更慢，但仍需统一超时，避免取消审核后继续等待长调用。
            return await self._run_with_call_timeout(
                self._call_openai_compatible(
                    multimodal_messages,
                    provider="openai",
                    model=model,
                    api_key=api_key,
                    base_url=base_url,
                    temperature=temperature,
                    request_timeout=effective_timeout,
                ),
                provider=normalized_provider,
                timeout=effective_timeout,
            )
        if normalized_provider == "zhipuai":
            # 视觉/OCR 单次请求通常更慢，但仍需统一超时，避免取消审核后继续等待长调用。
            return await self._run_with_call_timeout(
                self._call_zhipu_text(
                    multimodal_messages,
                    model=model,
                    api_key=api_key,
                    deep_think=deep_think,
                ),
                provider=normalized_provider,
                timeout=effective_timeout,
            )

        raise AppError("当前视觉调用 provider 无法识别。", status_code=400)

    async def _run_with_call_timeout(
        self,
        operation: Awaitable[str],
        *,
        provider: str,
        timeout: float,
    ) -> str:
        """给真实 SDK 调用套单次超时，并把 asyncio 超时转换成统一业务错误。"""

        try:
            return await asyncio.wait_for(operation, timeout=timeout)
        except asyncio.TimeoutError as exc:
            raise AppError(
                f"{provider} 单次模型调用超过 {timeout:g} 秒，已停止等待，请稍后重试或缩小文件内容。",
                status_code=504,
            ) from exc

    def _resolve_call_timeout(self, timeout: float | None) -> float:
        """解析单次调用超时；默认值集中在客户端侧，调用方也可以按场景覆盖。"""

        return self._DEFAULT_CALL_TIMEOUT_SECONDS if timeout is None else timeout

    async def test_connection(
        self,
        *,
        provider: str | None = None,
        requested_model: str | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> dict[str, Any]:
        """做一次最小远程连接测试，控制在短时超时范围内。"""

        try:
            response = await self.call_llm(
                [{"role": "user", "content": "Reply with OK."}],
                provider=provider,
                requested_model=requested_model,
                api_key=api_key,
                base_url=base_url,
                deep_think=False,
                temperature=0.0,
                timeout=self._CONNECTION_TEST_TIMEOUT_SECONDS,
            )
        except AppError as exc:
            if exc.status_code != 504:
                raise
            normalized_provider = self._resolve_provider(provider, requested_model)
            raise AppError(
                f"{normalized_provider} 连接测试超时，请稍后重试或检查网络。",
                status_code=504,
            ) from exc

        preview = (response or "").strip()
        return {
            "success": True,
            "message": "模型连接测试已返回响应。",
            "response_preview": preview[:120],
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
        request_timeout: float,
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
                # OpenAI 兼容 SDK 支持 HTTP 层 timeout；与 wait_for 同步，尽量让底层请求也尽快结束。
                client = OpenAI(
                    api_key=resolved_api_key,
                    base_url=resolved_base_url or None,
                    timeout=request_timeout,
                )
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
        deep_think: bool = False,
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
                payload = self._build_zhipu_payload(model=model, messages=messages, deep_think=deep_think)
                response = client.chat.completions.create(**payload)
                return response.choices[0].message.content or ""
            except Exception as exc:  # pragma: no cover
                raise self._map_exception("zhipuai", exc) from exc

        return await asyncio.to_thread(_run)

    @staticmethod
    def _build_zhipu_payload(
        *,
        model: str,
        messages: list[dict[str, Any]],
        deep_think: bool = False,
    ) -> dict[str, Any]:
        """构造智谱请求参数，按需启用 thinking。"""

        payload: dict[str, Any] = {"model": model, "messages": messages}
        if deep_think:
            payload["thinking"] = {"type": "enabled"}
        return payload

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
        """把底层 SDK 异常映射成中文友好错误。

        注意：不要把完整 API key 写入错误文案或日志。
        """

        message = str(exc)
        lowered = message.lower()

        # 401 / 403：鉴权失败
        if (
            "401" in lowered
            or "403" in lowered
            or "unauthorized" in lowered
            or "forbidden" in lowered
            or "invalid api key" in lowered
            or "incorrect api key" in lowered
            or "authentication" in lowered
        ):
            return AppError(
                f"{provider} 鉴权失败：API key 无效或没有调用权限。",
                status_code=401,
            )

        # 429：限流 / 余额不足
        if (
            "429" in lowered
            or "rate limit" in lowered
            or "too many requests" in lowered
            or "quota" in lowered
            or "insufficient" in lowered
            or "balance" in lowered
            or "overloaded" in lowered
            or "capacity" in lowered
        ):
            return AppError(
                f"{provider} 调用被限流或余额不足，请稍后重试或检查账户额度。",
                status_code=429,
            )

        # 404：模型或 endpoint 不存在
        if "404" in lowered or "not found" in lowered or "does not exist" in lowered:
            return AppError(
                f"{provider} 找不到目标模型或接口，请检查模型名是否正确。",
                status_code=404,
            )

        # 超时
        if "timeout" in lowered or "timed out" in lowered:
            return AppError(f"{provider} 请求超时，请稍后重试。", status_code=504)

        # 网络错误
        if (
            "connection" in lowered
            or "network" in lowered
            or "dns" in lowered
            or "unreachable" in lowered
            or "ssl" in lowered
            or "socket" in lowered
        ):
            return AppError(
                f"{provider} 网络连接失败，请检查网络或 endpoint 配置。",
                status_code=502,
            )

        # 5xx：供应商服务异常
        if any(code in lowered for code in ("500", "502", "503", "504")) or "server error" in lowered:
            return AppError(
                f"{provider} 供应商服务暂时异常，请稍后重试。",
                status_code=502,
            )

        # 400：请求参数或模型名不支持
        if (
            "400" in lowered
            or "bad request" in lowered
            or "invalid" in lowered
            or "unsupported" in lowered
        ):
            return AppError(
                f"{provider} 请求被拒：请求参数或模型名可能不受支持。详情：{message}",
                status_code=400,
            )

        return AppError(f"{provider} 调用失败：{message}", status_code=502)
