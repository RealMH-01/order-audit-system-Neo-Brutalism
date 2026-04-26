"""AI 引导对话引擎：管理多轮会话、完成标记提取和规则写回。"""

from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from app.config import Settings
from app.db.repository import SupabaseRepository
from app.db.supabase_client import ApiKeyCipher, EncryptionConfigurationError
from app.errors import AppError
from app.models.schemas import (
    CurrentUser,
    FeatureStatus,
    WizardCapability,
    WizardChatRequest,
    WizardChatResponse,
    WizardCompleteRequest,
    WizardSkipRequest,
    WizardSkipResponse,
    WizardStartRequest,
    WizardStartResponse,
)
from app.services.llm_client import LLMClientService
from app.services.runtime_store import RuntimeStore

WIZARD_SESSION_TIMEOUT = timedelta(minutes=30)
WIZARD_MAX_MESSAGE_LENGTH = 5000  # 单条消息最大字符数
WIZARD_MAX_MESSAGES = 30  # 单个 session 最大消息轮数

WIZARD_SYSTEM_PROMPT = """
你是一个经验丰富、耐心细致的外贸跟单同事，正在帮助新手梳理审核规则。

你的目标：
1. 通过多轮自然对话，帮助用户逐步说明行业背景、公司架构、特殊要求、客户要求和补充事项。
2. 每次只问 1 到 2 个问题，不要像机械表单一样追问。
3. 如果用户说“没有”“不确定”“不需要”“一般一样”，请自然跳过当前主题，不要死追问。
4. 语气要像资深同事带新人，简洁、温和、专业。
5. 当信息已经足够生成审核规则时，请先用自然语言做一个简短总结，然后在回复最后追加一个 fenced json 代码块。

完成标记格式必须是：
```json
{
  "wizard_complete": true,
  "generated_rules": ["规则1", "规则2"],
  "generated_affiliates": ["公司A", "公司B"]
}
```

注意：
- generated_rules 必须是可以直接写入系统的审核规则要点列表。
- generated_affiliates 只保留用户明确提到的集团关联公司或关联主体。
- 如果信息还不够，请不要输出完成标记。
""".strip()


@dataclass
class WizardSession:
    """引导对话会话结构。"""

    session_id: str
    user_id: str
    provider: str
    api_key: str | None
    selected_model: str
    selected_template: str | None
    template_rules: str | None
    messages: list[dict[str, str]] = field(default_factory=list)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    last_active_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    is_complete: bool = False
    generated_rules: list[str] = field(default_factory=list)
    generated_affiliates: list[str] = field(default_factory=list)

    def is_expired(self) -> bool:
        """判断会话是否超时。"""

        return datetime.now(timezone.utc) - self.last_active_at > WIZARD_SESSION_TIMEOUT


_wizard_sessions: dict[str, WizardSession] = {}


class WizardEngineService:
    """管理 AI 引导会话的创建、对话、完成和跳过流程。"""

    def __init__(
        self,
        settings: Settings,
        store: RuntimeStore,
        llm_client: LLMClientService,
        cipher: ApiKeyCipher,
        repo: SupabaseRepository | None = None,
    ) -> None:
        self.settings = settings
        self.store = store
        self.llm_client = llm_client
        self.cipher = cipher
        self.repo = repo

    def get_capability(self) -> WizardCapability:
        """返回当前引导模块能力说明。"""

        return WizardCapability(
            phases=["industry-background", "company-structure", "special-rules", "customer-rules", "summary"],
            features=[
                FeatureStatus(
                    name="多轮引导对话",
                    ready=True,
                    note="已支持 session 管理、连续对话、完成标记提取和规则写回。",
                ),
                FeatureStatus(
                    name="会话超时清理",
                    ready=True,
                    note="已支持 30 分钟超时清理和后台定时回收。",
                ),
            ],
        )

    async def start(self, current_user: CurrentUser, payload: WizardStartRequest) -> WizardStartResponse:
        """创建会话并返回第一条自然语言引导消息。"""

        self.cleanup_expired_sessions()
        profile = self._get_profile(current_user.id)
        selected_model = str(profile.get("selected_model") or self.settings.default_text_model)
        provider = self.llm_client._resolve_provider(payload.provider, selected_model)
        api_key = self._resolve_api_key(profile, provider)
        selected_template, template_rules = self._resolve_template_context(payload)

        session_id = str(uuid4())
        initial_message = self.build_wizard_initial_message(selected_template, template_rules)

        session = WizardSession(
            session_id=session_id,
            user_id=current_user.id,
            provider=provider,
            api_key=api_key,
            selected_model=selected_model,
            selected_template=selected_template,
            template_rules=template_rules,
            messages=[
                {"role": "system", "content": WIZARD_SYSTEM_PROMPT},
                {"role": "assistant", "content": initial_message},
            ],
        )
        if payload.first_message and payload.first_message.strip():
            first_message = payload.first_message.strip()
            self._validate_user_message(first_message, len(session.messages))
            session.messages.append({"role": "user", "content": first_message})
        _wizard_sessions[session_id] = session

        return WizardStartResponse(
            session_id=session_id,
            ai_message=initial_message,
            step=self._infer_step(session),
            is_complete=False,
        )

    async def chat(self, current_user: CurrentUser, payload: WizardChatRequest) -> WizardChatResponse:
        """处理一轮用户对话。"""

        return await self.process_wizard_chat(current_user, payload)

    async def process_wizard_chat(
        self,
        current_user: CurrentUser,
        payload: WizardChatRequest,
    ) -> WizardChatResponse:
        """将用户消息写入会话，调用模型并返回最新 AI 回复。"""

        session = self._get_session(current_user.id, payload.session_id)
        user_message = payload.message.strip()
        self._validate_user_message(user_message, len(session.messages))
        session.messages.append({"role": "user", "content": user_message})
        session.last_active_at = datetime.now(timezone.utc)

        ai_message = await self._call_wizard_llm(session)
        session.messages.append({"role": "assistant", "content": ai_message})
        session.last_active_at = datetime.now(timezone.utc)

        is_complete, generated_rules, generated_affiliates = self._extract_wizard_complete(ai_message)
        cleaned_message = self._clean_wizard_response(ai_message)

        if is_complete:
            session.is_complete = True
            session.generated_rules = generated_rules
            session.generated_affiliates = generated_affiliates

        return WizardChatResponse(
            session_id=session.session_id,
            ai_message=cleaned_message,
            step=self._infer_step(session),
            is_complete=session.is_complete,
            generated_rules=list(session.generated_rules),
            generated_affiliates=list(session.generated_affiliates),
        )

    def complete(self, current_user: CurrentUser, payload: WizardCompleteRequest) -> WizardSkipResponse:
        """确认引导结果并写回 profile。"""

        session = self._get_session(current_user.id, payload.session_id)
        profile = self._get_profile(current_user.id)

        final_rules = list(payload.final_rules) or list(session.generated_rules) or list(profile.get("active_custom_rules", []))
        affiliates = list(payload.generated_affiliates) or list(session.generated_affiliates)
        affiliate_roles = list(payload.generated_affiliate_roles)

        profile["active_custom_rules"] = final_rules
        profile["company_affiliates"] = affiliates
        profile["company_affiliates_roles"] = affiliate_roles
        profile["wizard_completed"] = True
        profile["updated_at"] = datetime.now(timezone.utc)
        profile = self._save_profile(current_user.id, profile)

        session.is_complete = True
        session.generated_rules = final_rules
        session.generated_affiliates = affiliates

        return WizardSkipResponse(
            message="引导规则已确认并写回当前用户资料。",
            is_complete=True,
            generated_rules=final_rules,
            generated_affiliates=affiliates,
        )

    def skip(self, current_user: CurrentUser, payload: WizardSkipRequest) -> WizardSkipResponse:
        """跳过 AI 对话，直接保存用户手写或导入规则。"""

        profile = self._get_profile(current_user.id)
        if payload.rules_text:
            profile["active_custom_rules"] = list(payload.rules_text)
        if payload.generated_affiliates:
            profile["company_affiliates"] = list(payload.generated_affiliates)
        if payload.generated_affiliate_roles:
            profile["company_affiliates_roles"] = list(payload.generated_affiliate_roles)
        profile["wizard_completed"] = True
        profile["updated_at"] = datetime.now(timezone.utc)
        profile = self._save_profile(current_user.id, profile)

        return WizardSkipResponse(
            message="已跳过 AI 引导，并保存当前规则配置。",
            is_complete=True,
            generated_rules=list(profile.get("active_custom_rules", [])),
            generated_affiliates=list(profile.get("company_affiliates", [])),
        )

    def build_wizard_initial_message(
        self,
        selected_template: str | None,
        template_rules: str | None,
    ) -> str:
        """根据模板上下文生成自然的第一条引导消息。"""

        template_name = (selected_template or "").strip()
        template_text = (template_rules or "").strip()

        if not template_name or template_name in {"通用外贸", "generic", "default"}:
            return (
                "我们先从最基础的场景开始。我会像老同事带新人一样，帮你一点点把审核规则理顺。"
                "先告诉我两件事：你现在主要审核哪些单据，和你们这个业务最怕出错的点是什么？"
            )

        if template_text:
            return (
                f"我先按你选的模板“{template_name}”做参考，这样我们不用从零开始。"
                f"我看到模板里已经强调了这些方向：{template_text[:180]}。"
                "接下来我只想确认两点：这个模板在哪些地方还不够贴合你们实际业务？你们公司有没有集团关联公司或多个主体需要特别区分？"
            )

        return (
            f"我们先以“{template_name}”这个模板为基础往下收细节。"
            "你先告诉我：这个模板最需要补强的是哪一类规则？另外你们有没有固定客户要求或内部特殊要求？"
        )

    def cleanup_expired_sessions(self) -> int:
        """清理超时会话，返回清理数量。"""

        expired_ids = [session_id for session_id, session in _wizard_sessions.items() if session.is_expired()]
        for session_id in expired_ids:
            _wizard_sessions.pop(session_id, None)
        return len(expired_ids)

    def _extract_wizard_complete(self, ai_message: str) -> tuple[bool, list[str], list[str]]:
        """从 AI 回复中提取完成标记与生成结果。"""

        text = ai_message or ""

        for block in re.findall(r"```json\s*([\s\S]*?)```", text, flags=re.IGNORECASE):
            try:
                payload = json.loads(block.strip())
            except json.JSONDecodeError:
                continue

            if self._is_wizard_complete_payload(payload):
                return (
                    True,
                    self._normalize_generated_list(payload.get("generated_rules")),
                    self._normalize_generated_list(payload.get("generated_affiliates")),
                )

        if re.search(r"wizard_complete\s*[:=]\s*true", text, flags=re.IGNORECASE):
            return True, [], []

        return False, [], []

    def _clean_wizard_response(self, ai_message: str) -> str:
        """去掉回复中的完成 JSON 标记块，只保留自然语言。"""

        cleaned = re.sub(
            r"```json\s*[\s\S]*?wizard_complete[\s\S]*?```",
            "",
            ai_message or "",
            flags=re.IGNORECASE,
        )
        cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
        return cleaned.strip()

    async def _call_wizard_llm(self, session: WizardSession) -> str:
        """调用模型并在空响应时自动重试一次。"""

        for _ in range(2):
            response = await self.llm_client.call_llm(
                session.messages,
                provider=session.provider,
                requested_model=session.selected_model,
                api_key=session.api_key,
                deep_think=False,
                temperature=0.6,
            )
            if response and response.strip():
                return response.strip()
        raise AppError("AI 暂未返回有效内容，请稍后重试。", status_code=502)

    def _get_session(self, user_id: str, session_id: str) -> WizardSession:
        """读取并校验会话。"""

        self.cleanup_expired_sessions()
        session = _wizard_sessions.get(session_id)
        if not session or session.user_id != user_id:
            raise AppError("未找到指定引导会话，可能已过期，请重新开始。", status_code=404)
        if session.is_expired():
            _wizard_sessions.pop(session_id, None)
            raise AppError("引导会话已过期，请重新开始。", status_code=404)
        return session

    @staticmethod
    def _validate_user_message(message: str, current_message_count: int) -> None:
        """校验用户单条消息长度和会话消息数量。"""

        if len(message) > WIZARD_MAX_MESSAGE_LENGTH:
            raise AppError("单条消息不能超过 5000 字，请精简后重新发送。", status_code=400)
        if current_message_count >= WIZARD_MAX_MESSAGES:
            raise AppError("当前对话已达到轮数上限，请确认当前规则或重新开始新会话。", status_code=400)

    def _get_profile(self, user_id: str) -> dict[str, object]:
        """读取当前用户 profile。"""

        if self.repo is not None:
            profile = self.repo.get_profile(user_id)
            if profile:
                self.store.profiles[user_id] = profile
                return profile

        profile = self.store.profiles.get(user_id)
        if not profile:
            raise AppError("当前用户资料不存在，请重新登录后再试。", status_code=404)
        return profile

    def _resolve_template_context(self, payload: WizardStartRequest) -> tuple[str | None, str | None]:
        """解析模板名称与模板规则文本。"""

        if payload.template_rules:
            return payload.selected_template, payload.template_rules

        selected = (payload.selected_template or "").strip()
        if not selected:
            return None, None

        if self.repo is not None:
            template = self.repo.get_template(selected)
            if template:
                self.store.templates[str(template["id"])] = template
                return str(template.get("name") or selected), str(template.get("rules_text") or "")

        if selected in self.store.templates:
            template = self.store.templates[selected]
            return str(template.get("name") or selected), str(template.get("rules_text") or "")

        for template in self.store.templates.values():
            if str(template.get("name", "")).strip() == selected:
                return str(template.get("name")), str(template.get("rules_text") or "")

        return selected, None

    def _save_profile(self, user_id: str, profile: dict[str, object]) -> dict[str, object]:
        if self.repo is not None:
            updates = {
                "active_custom_rules": profile.get("active_custom_rules", []),
                "company_affiliates": profile.get("company_affiliates", []),
                "company_affiliates_roles": profile.get("company_affiliates_roles", []),
                "wizard_completed": profile.get("wizard_completed", False),
                "updated_at": profile.get("updated_at"),
            }
            if self.repo.get_profile(user_id) is None:
                profile = self.repo.upsert_profile(user_id, profile)
            else:
                if bool(profile.get("wizard_completed")):
                    profile = self.repo.mark_wizard_completed(
                        user_id,
                        list(profile.get("active_custom_rules", [])),
                    )
                    profile = self.repo.update_profile(
                        user_id,
                        {
                            "company_affiliates": updates["company_affiliates"],
                            "company_affiliates_roles": updates["company_affiliates_roles"],
                            "updated_at": updates["updated_at"],
                        },
                    )
                else:
                    profile = self.repo.update_profile(user_id, updates)
        self.store.profiles[user_id] = profile
        return profile

    def _resolve_api_key(self, profile: dict[str, object], provider: str) -> str | None:
        """根据 provider 读取并尽量解密 API key。"""

        field_name = {
            "openai": "openai_api_key",
            "deepseek": "deepseek_api_key",
            "zhipuai": "zhipu_api_key",
        }[provider]
        raw_value = profile.get(field_name)
        if not raw_value:
            return None

        api_key = str(raw_value)
        if not self.cipher.is_configured():
            return api_key

        try:
            return self.cipher.decrypt(api_key)
        except EncryptionConfigurationError:
            return api_key
        except Exception:
            return api_key

    def _infer_step(self, session: WizardSession) -> str:
        """根据对话轮次推断当前步骤。"""

        if session.is_complete:
            return "summary"

        user_turns = sum(1 for message in session.messages if message.get("role") == "user")
        if user_turns <= 1:
            return "industry-background"
        if user_turns == 2:
            return "company-structure"
        if user_turns == 3:
            return "special-rules"
        if user_turns == 4:
            return "customer-rules"
        return "summary"

    @staticmethod
    def _is_wizard_complete_payload(payload: Any) -> bool:
        """判断解析出来的 payload 是否是合法完成标记。"""

        if not isinstance(payload, dict):
            return False
        flag = payload.get("wizard_complete")
        return flag is True or str(flag).strip().lower() == "true"

    @staticmethod
    def _normalize_generated_list(value: Any) -> list[str]:
        """把模型返回的规则/公司列表规范成字符串数组。"""

        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        if isinstance(value, str):
            return [line.strip("- ").strip() for line in value.splitlines() if line.strip()]
        return []


async def run_wizard_cleanup_loop(interval_seconds: int = 300) -> None:
    """后台定时清理超时会话。"""

    while True:
        await asyncio.sleep(interval_seconds)
        expired_ids = [session_id for session_id, session in _wizard_sessions.items() if session.is_expired()]
        for session_id in expired_ids:
            _wizard_sessions.pop(session_id, None)
