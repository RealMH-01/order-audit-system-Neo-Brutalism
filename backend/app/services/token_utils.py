"""Token 工具：估算、截断与智能分段。"""

from __future__ import annotations

import re
from typing import Any

from app.models.schemas import FeatureStatus

try:
    import tiktoken
except Exception:  # pragma: no cover
    tiktoken = None

_MODEL_TOKEN_LIMITS = {
    "gpt-4o": 128000,
    "o3-mini": 200000,
    # DeepSeek V4 主路径
    "deepseek-v4-flash": 1000000,
    "deepseek-v4-pro": 1000000,
    # DeepSeek 旧模型名：保留兼容，避免历史 profile 崩
    "deepseek-chat": 1000000,
    "deepseek-reasoner": 1000000,
    "glm-4-flash": 128000,
    "glm-4v": 32000,
}


class TokenUtilityService:
    """提供 token 估算和上下文控制能力。"""

    def get_features(self) -> list[FeatureStatus]:
        """返回当前 token 工具能力说明。"""

        return [
            FeatureStatus(
                name="Token 估算与安全上限",
                ready=True,
                note="已支持常见模型上限、估算、截断与智能分段。",
            )
        ]

    def estimate_tokens(self, content: str, model: str | None = None) -> int:
        """估算文本 token 数量。"""

        text = content or ""
        if not text:
            return 0

        if tiktoken is not None:
            try:
                encoding = tiktoken.encoding_for_model(model or "gpt-4o")
            except Exception:
                encoding = tiktoken.get_encoding("cl100k_base")
            return len(encoding.encode(text))

        return max(1, len(text) // 4)

    def get_model_token_limit(self, model: str | None) -> int:
        """返回模型理论上下文上限。"""

        normalized = (model or "").strip().lower()
        if normalized in _MODEL_TOKEN_LIMITS:
            return _MODEL_TOKEN_LIMITS[normalized]
        if normalized.startswith("gpt-4o"):
            return _MODEL_TOKEN_LIMITS["gpt-4o"]
        if normalized.startswith("o3"):
            return _MODEL_TOKEN_LIMITS["o3-mini"]
        if normalized.startswith("deepseek"):
            return _MODEL_TOKEN_LIMITS["deepseek-chat"]
        if normalized.startswith("glm-4v"):
            return _MODEL_TOKEN_LIMITS["glm-4v"]
        if normalized.startswith("glm"):
            return _MODEL_TOKEN_LIMITS["glm-4-flash"]
        return 32000

    def get_safe_token_limit(self, model: str | None, reserved_output_tokens: int = 4000) -> int:
        """返回为输入内容预留的安全 token 上限。"""

        limit = self.get_model_token_limit(model)
        safe_limit = int(limit * 0.8)
        return max(1024, min(safe_limit, limit - reserved_output_tokens))

    def truncate_text(self, content: str, max_tokens: int, model: str | None = None) -> str:
        """按 token 上限截断文本。"""

        text = content or ""
        if self.estimate_tokens(text, model) <= max_tokens:
            return text

        if tiktoken is not None:
            try:
                encoding = tiktoken.encoding_for_model(model or "gpt-4o")
            except Exception:
                encoding = tiktoken.get_encoding("cl100k_base")
            encoded = encoding.encode(text)
            return encoding.decode(encoded[:max_tokens])

        approx_chars = max_tokens * 4
        return text[:approx_chars]

    def smart_split_content(
        self,
        content: str,
        *,
        max_tokens: int,
        model: str | None = None,
        overlap_tokens: int = 120,
    ) -> list[str]:
        """把长文本智能切分成多个 token 安全片段。"""

        text = (content or "").strip()
        if not text:
            return []
        if self.estimate_tokens(text, model) <= max_tokens:
            return [text]

        paragraphs = [block.strip() for block in re.split(r"\n\s*\n", text) if block.strip()]
        chunks: list[str] = []
        current = ""

        for paragraph in paragraphs:
            candidate = f"{current}\n\n{paragraph}".strip() if current else paragraph
            if self.estimate_tokens(candidate, model) <= max_tokens:
                current = candidate
                continue

            if current:
                chunks.append(current)
                tail = self.truncate_text(current, overlap_tokens, model=model)
                current = f"{tail}\n\n{paragraph}".strip()
            else:
                chunks.extend(self._split_oversized_paragraph(paragraph, max_tokens=max_tokens, model=model))
                current = ""

        if current:
            chunks.append(current)

        return chunks

    def _split_oversized_paragraph(self, paragraph: str, *, max_tokens: int, model: str | None) -> list[str]:
        """把超长段落继续拆小。"""

        sentences = re.split(r"(?<=[。！？.!?])\s+", paragraph)
        chunks: list[str] = []
        current = ""
        for sentence in sentences:
            sentence = sentence.strip()
            if not sentence:
                continue
            candidate = f"{current} {sentence}".strip() if current else sentence
            if self.estimate_tokens(candidate, model) <= max_tokens:
                current = candidate
                continue
            if current:
                chunks.append(current)
            if self.estimate_tokens(sentence, model) <= max_tokens:
                current = sentence
            else:
                remaining = sentence
                while remaining and self.estimate_tokens(remaining, model) > max_tokens:
                    chunk = self.truncate_text(remaining, max_tokens, model=model)
                    if not chunk:
                        break
                    chunks.append(chunk)
                    remaining = remaining[len(chunk) :].lstrip()
                current = remaining
        if current:
            chunks.append(current)
        return chunks
