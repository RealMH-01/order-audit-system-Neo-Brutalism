"""Pydantic schemas used by the HTTP and service layers."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class FeatureStatus(BaseModel):
    """Describe whether a feature is currently available."""

    name: str
    ready: bool
    note: str


class MessageResponse(BaseModel):
    """Simple message response."""

    message: str


class HealthStatus(BaseModel):
    """Health-check response."""

    status: str = Field(..., description="Service status")
    service: str = Field(..., description="Service name")
    version: str = Field(..., description="Service version")
    environment: str = Field(..., description="Current environment")


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


class AuthRegisterRequest(BaseModel):
    """Register request."""

    email: EmailStr
    password: str = Field(min_length=6)
    display_name: str | None = None


class AuthLoginRequest(BaseModel):
    """Login request."""

    email: EmailStr
    password: str = Field(min_length=6)


class CurrentUser(BaseModel):
    """Simplified current-user model."""

    id: str
    email: EmailStr
    display_name: str | None = None
    role: Literal["user", "admin"] = "user"


class AuthTokenResponse(BaseModel):
    """Register/login response."""

    access_token: str
    token_type: Literal["bearer"] = "bearer"
    user: CurrentUser


class ProfileRecord(BaseModel):
    """Database-facing profile record."""

    model_config = ConfigDict(extra="ignore")

    id: UUID | str
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


class ProfileResponse(BaseModel):
    """Profile response without raw API keys."""

    id: str
    display_name: str | None = None
    selected_model: str
    deep_think_enabled: bool
    company_affiliates: list[str]
    company_affiliates_roles: list[dict[str, str]]
    active_custom_rules: list[str]
    wizard_completed: bool
    disclaimer_accepted: bool
    role: Literal["user", "admin"]
    has_deepseek_key: bool
    has_zhipu_key: bool
    has_zhipu_ocr_key: bool
    has_openai_key: bool
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ProfileUpdateRequest(BaseModel):
    """Minimal profile update request."""

    display_name: str | None = None
    selected_model: str | None = None
    deep_think_enabled: bool | None = None
    company_affiliates: list[str] | None = None
    company_affiliates_roles: list[dict[str, str]] | None = None
    deepseek_api_key: str | None = None
    zhipu_api_key: str | None = None
    zhipu_ocr_api_key: str | None = None
    openai_api_key: str | None = None


class DisclaimerUpdateRequest(BaseModel):
    """Disclaimer update request."""

    disclaimer_accepted: bool


class ConnectionTestRequest(BaseModel):
    """Connection test request."""

    provider: Literal["openai", "deepseek", "zhipuai", "zhipu-ocr"]
    use_saved_key: bool = True
    api_key: str | None = None
    model: str | None = None


class ConnectionTestResponse(BaseModel):
    """Connection test response."""

    success: bool
    message: str
    response_preview: str | None = None


class IndustryTemplateSeed(BaseModel):
    """Default industry template payload."""

    name: str
    description: str
    rules_text: str
    company_affiliates: list[str] = Field(default_factory=list)
    is_system: bool = True
    user_id: UUID | str | None = None


class IndustryTemplateRecord(IndustryTemplateSeed):
    """Database-facing template record."""

    model_config = ConfigDict(extra="ignore")

    id: UUID | str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class TemplateResponse(BaseModel):
    """Template response."""

    id: str
    name: str
    description: str
    rules_text: str
    company_affiliates: list[str]
    is_system: bool
    user_id: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class TemplateCreateRequest(BaseModel):
    """Create template request."""

    name: str = Field(min_length=1)
    description: str = ""
    rules_text: str = Field(min_length=1)
    company_affiliates: list[str] = Field(default_factory=list)


class TemplateUpdateRequest(BaseModel):
    """Update template request."""

    name: str | None = None
    description: str | None = None
    rules_text: str | None = None
    company_affiliates: list[str] | None = None


class TemplateLoadResponse(BaseModel):
    """Template-load response."""

    template: TemplateResponse
    loaded_rules: list[str]
    message: str


class TemplateListResponse(BaseModel):
    """Template-list response."""

    templates: list[TemplateResponse]


class AuditHistoryRecord(BaseModel):
    """Database-facing audit-history record."""

    model_config = ConfigDict(extra="ignore")

    id: UUID | str | None = None
    user_id: UUID | str
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


class AuditHistoryItem(BaseModel):
    """Audit-history list item."""

    id: str
    model_used: str
    document_count: int
    red_count: int
    yellow_count: int
    blue_count: int
    deep_think_used: bool
    created_at: datetime | None = None


class AuditHistoryListResponse(BaseModel):
    """Audit-history list response."""

    items: list[AuditHistoryItem]


class AuditHistoryDetailResponse(BaseModel):
    """Audit-history detail response."""

    item: AuditHistoryRecord


class SystemRuleSeed(BaseModel):
    """Default system-rule payload."""

    key: str
    display_text: str
    prompt_text: str


class SystemRuleRecord(SystemRuleSeed):
    """Database-facing system-rule record."""

    model_config = ConfigDict(extra="ignore")

    id: UUID | str | None = None
    updated_by: UUID | str | None = None
    updated_at: datetime | None = None


class BuiltinRulePublicResponse(BaseModel):
    """Public builtin-rule response."""

    key: str
    display_text: str
    updated_at: datetime | None = None


class BuiltinRuleFullResponse(BaseModel):
    """Full builtin-rule response."""

    key: str
    display_text: str
    prompt_text: str
    updated_at: datetime | None = None


class BuiltinRuleUpdateRequest(BaseModel):
    """Builtin-rule update request."""

    display_text: str = Field(min_length=1)
    prompt_text: str = Field(min_length=1)


class CustomRulesResponse(BaseModel):
    """Current-user custom rules."""

    rules: list[str]


class CustomRulesUpdateRequest(BaseModel):
    """Custom-rules update request."""

    rules: list[str] = Field(default_factory=list)


class FileRecord(BaseModel):
    """Uploaded-file preview record."""

    id: str
    filename: str
    content_type: str
    size_bytes: int
    detected_type: str
    preview_text: str
    uploaded_at: datetime


class FileUploadResponse(BaseModel):
    """File upload response."""

    file: FileRecord
    message: str


class FileDeleteResponse(BaseModel):
    """File delete response."""

    file_id: str
    message: str


class AuditFileRefItem(BaseModel):
    """Object-style file reference used by audit-start payloads."""

    file_id: str
    document_type: str | None = None
    label: str | None = None


class AuditStartRequest(BaseModel):
    """Start-audit request aligned with the original contract."""

    po_file_id: str
    target_files: list[AuditFileRefItem] = Field(min_length=1)
    prev_ticket_files: list[AuditFileRefItem] = Field(default_factory=list)
    template_file_id: str | None = None
    reference_file_ids: list[str] = Field(default_factory=list)
    deep_think: bool = False


class AuditStartResponse(BaseModel):
    """Start-audit response."""

    task_id: str
    status: str
    message: str


class AuditProgressPayload(BaseModel):
    """Audit-progress SSE payload."""

    task_id: str
    status: str
    progress_percent: int
    message: str
    created_at: datetime
    updated_at: datetime


class AuditIssue(BaseModel):
    """Minimal audit-issue payload."""

    id: str | None = None
    level: Literal["RED", "YELLOW", "BLUE"]
    field_name: str
    message: str
    confidence: float | None = None
    suggestion: str | None = None
    document_label: str | None = None
    document_type: str | None = None
    file_id: str | None = None
    matched_po_value: str | None = None
    observed_value: str | None = None
    source_excerpt: str | None = None


class AuditResultResponse(BaseModel):
    """Audit-result response."""

    task_id: str
    status: str
    summary: dict[str, int]
    issues: list[AuditIssue]
    message: str


class AuditCancelResponse(BaseModel):
    """Audit-cancel response."""

    task_id: str
    status: str
    message: str


class AuditReportResponse(BaseModel):
    """Report endpoint placeholder response."""

    task_id: str
    message: str


class WizardStartRequest(BaseModel):
    """Wizard start request."""

    first_message: str | None = None
    selected_template: str | None = None
    template_rules: str | None = None
    provider: Literal["openai", "deepseek", "zhipuai"] | None = None


class WizardStartResponse(BaseModel):
    """Wizard start response."""

    session_id: str
    ai_message: str
    step: str
    is_complete: bool = False


class WizardChatRequest(BaseModel):
    """Wizard chat request."""

    session_id: str
    message: str = Field(min_length=1)


class WizardChatResponse(BaseModel):
    """Wizard chat response."""

    session_id: str
    ai_message: str
    step: str
    is_complete: bool = False
    generated_rules: list[str] = Field(default_factory=list)
    generated_affiliates: list[str] = Field(default_factory=list)


class WizardCompleteRequest(BaseModel):
    """Wizard complete request."""

    session_id: str
    final_rules: list[str] = Field(default_factory=list)
    generated_affiliates: list[str] = Field(default_factory=list)
    generated_affiliate_roles: list[dict[str, str]] = Field(default_factory=list)


class WizardSkipRequest(BaseModel):
    """Wizard skip request."""

    rules_text: list[str] = Field(default_factory=list)
    generated_affiliates: list[str] = Field(default_factory=list)
    generated_affiliate_roles: list[dict[str, str]] = Field(default_factory=list)


class WizardSkipResponse(BaseModel):
    """Wizard skip/complete common response."""

    message: str
    is_complete: bool = True
    generated_rules: list[str] = Field(default_factory=list)
    generated_affiliates: list[str] = Field(default_factory=list)


class DatabaseTableSpec(BaseModel):
    """Database table spec for docs."""

    name: str
    purpose: str
    key_columns: list[str]


class RLSPolicySpec(BaseModel):
    """RLS policy spec for docs."""

    table_name: str
    actor: str
    action: str
    condition: str


class BootstrapDataPlan(BaseModel):
    """Bootstrap plan used by init logic."""

    system_rule: SystemRuleSeed
    system_templates: list[IndustryTemplateSeed]
    note: str


class SeedExecutionResult(BaseModel):
    """Single seed execution result."""

    entity: str
    identifier: str
    action: Literal["inserted", "skipped", "failed"]
    detail: str


class DatabaseBootstrapResult(BaseModel):
    """Summary of bootstrap execution."""

    executed: bool
    message: str
    results: list[SeedExecutionResult] = Field(default_factory=list)
