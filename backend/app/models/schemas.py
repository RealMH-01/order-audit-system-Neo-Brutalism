"""集中定义接口响应、数据库记录和初始化结果所需的 Pydantic schema。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


class FeatureStatus(BaseModel):
    """描述某个模块能力当前是否已可用。"""

    name: str
    ready: bool
    note: str


class HealthStatus(BaseModel):
    """基础服务健康检查返回。"""

    status: str = Field(..., description="服务整体状态")
    service: str = Field(..., description="服务名称")
    version: str = Field(..., description="服务版本")
    environment: str = Field(..., description="当前环境")


class AuthCapability(BaseModel):
    provider: str
    features: list[FeatureStatus]


class FileCapability(BaseModel):
    supported_types: list[str]
    features: list[FeatureStatus]


class AuditCapability(BaseModel):
    mode: str
    features: list[FeatureStatus]


class RulesCapability(BaseModel):
    scopes: list[str]
    features: list[FeatureStatus]


class SettingsCapability(BaseModel):
    sections: list[str]
    features: list[FeatureStatus]


class WizardCapability(BaseModel):
    phases: list[str]
    features: list[FeatureStatus]


class ProfileRecord(BaseModel):
    """profiles 表的数据表达，字段名尽量贴近原始数据库设计。"""

    id: UUID
    display_name: str | None = None
    selected_model: str = "gpt-4o"
    deepseek_api_key: str | None = None
    zhipu_api_key: str | None = None
    zhipu_ocr_api_key: str | None = None
    openai_api_key: str | None = None
    deep_think_enabled: bool = False
    company_affiliates: list[str] = Field(default_factory=list)
    company_affiliates_roles: list[dict[str, str]] = Field(default_factory=list)
    active_custom_rules: list[str] = Field(default_factory=list)
    wizard_completed: bool = False
    disclaimer_accepted: bool = False
    role: Literal["user", "admin"] = "user"
    created_at: datetime | None = None
    updated_at: datetime | None = None


class IndustryTemplateSeed(BaseModel):
    """industry_templates 的默认系统模板内容。"""

    name: str
    description: str
    rules_text: str
    company_affiliates: list[str] = Field(default_factory=list)
    is_system: bool = True
    user_id: UUID | None = None


class IndustryTemplateRecord(IndustryTemplateSeed):
    """industry_templates 表的数据表达。"""

    id: UUID | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class AuditHistoryRecord(BaseModel):
    """audit_history 表的数据表达。"""

    id: UUID | None = None
    user_id: UUID
    document_count: int = 0
    red_count: int = 0
    yellow_count: int = 0
    blue_count: int = 0
    audit_result: dict[str, Any] = Field(default_factory=dict)
    model_used: str
    custom_rules_snapshot: list[str] = Field(default_factory=list)
    deep_think_used: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None


class SystemRuleSeed(BaseModel):
    """system_rules 表默认记录的初始化表达。"""

    key: str
    display_text: str
    prompt_text: str


class SystemRuleRecord(SystemRuleSeed):
    """system_rules 表的数据表达。"""

    id: UUID | None = None
    updated_by: UUID | None = None
    updated_at: datetime | None = None


class DatabaseTableSpec(BaseModel):
    """文档化展示单张表的关键设计点。"""

    name: str
    purpose: str
    key_columns: list[str]


class RLSPolicySpec(BaseModel):
    """文档化展示 RLS 策略摘要。"""

    table_name: str
    actor: str
    action: str
    condition: str


class BootstrapDataPlan(BaseModel):
    """初始化阶段的目标数据说明。"""

    system_rule: SystemRuleSeed
    system_templates: list[IndustryTemplateSeed]
    note: str


class SeedExecutionResult(BaseModel):
    """单条初始化动作执行结果。"""

    entity: str
    identifier: str
    action: Literal["inserted", "skipped", "failed"]
    detail: str


class DatabaseBootstrapResult(BaseModel):
    """幂等初始化执行结果摘要。"""

    executed: bool
    message: str
    results: list[SeedExecutionResult] = Field(default_factory=list)
