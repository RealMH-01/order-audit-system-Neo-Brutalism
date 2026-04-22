"""提供 AI 引导接口的最小占位闭环。"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from app.config import Settings
from app.errors import AppError
from app.models.schemas import (
    CurrentUser,
    FeatureStatus,
    WizardCapability,
    WizardChatRequest,
    WizardChatResponse,
    WizardCompleteRequest,
    WizardSkipResponse,
    WizardStartRequest,
    WizardStartResponse,
)
from app.services.runtime_store import RuntimeStore


class WizardEngineService:
    """管理向导会话的最小接口链路。"""

    def __init__(self, settings: Settings, store: RuntimeStore) -> None:
        self.settings = settings
        self.store = store

    def get_capability(self) -> WizardCapability:
        return WizardCapability(
            phases=["collect-context", "suggest-template", "confirm-rules"],
            features=[
                FeatureStatus(
                    name="向导主链路占位",
                    ready=True,
                    note="已提供 start/chat/complete/skip 的最小接口闭环。",
                )
            ],
        )

    def start(self, current_user: CurrentUser, payload: WizardStartRequest) -> WizardStartResponse:
        session_id = str(uuid4())
        self.store.wizard_sessions[session_id] = {
            "session_id": session_id,
            "user_id": current_user.id,
            "messages": [payload.first_message] if payload.first_message else [],
            "created_at": datetime.now(timezone.utc),
        }
        return WizardStartResponse(session_id=session_id, message="向导会话已启动。")

    def chat(self, current_user: CurrentUser, payload: WizardChatRequest) -> WizardChatResponse:
        session = self._get_session(current_user.id, payload.session_id)
        session["messages"].append(payload.message)
        return WizardChatResponse(
            session_id=payload.session_id,
            reply="本轮仅保留向导对话骨架，后续会接入真实引导逻辑。",
        )

    def complete(self, current_user: CurrentUser, payload: WizardCompleteRequest) -> WizardSkipResponse:
        self._get_session(current_user.id, payload.session_id)
        profile = self.store.profiles.get(current_user.id)
        if profile:
            profile["wizard_completed"] = True
            profile["updated_at"] = datetime.now(timezone.utc)
        return WizardSkipResponse(message="向导已标记为完成。")

    def skip(self, current_user: CurrentUser) -> WizardSkipResponse:
        profile = self.store.profiles.get(current_user.id)
        if not profile:
            raise AppError("当前用户资料不存在，请重新登录。", status_code=404)
        profile["wizard_completed"] = False
        profile["updated_at"] = datetime.now(timezone.utc)
        return WizardSkipResponse(message="已跳过向导流程。")

    def _get_session(self, user_id: str, session_id: str) -> dict[str, object]:
        session = self.store.wizard_sessions.get(session_id)
        if not session or session.get("user_id") != user_id:
            raise AppError("未找到指定向导会话。", status_code=404)
        return session
