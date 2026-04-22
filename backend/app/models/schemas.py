from pydantic import BaseModel, Field


class FeatureStatus(BaseModel):
    name: str
    ready: bool
    note: str


class HealthStatus(BaseModel):
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

