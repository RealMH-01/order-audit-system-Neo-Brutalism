"""Backend foundation for fixed audit rules, rule packages, and user templates."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from app.db.repository import SupabaseRepository
from app.errors import AppError
from app.models.schemas import (
    AuditRulePackageListResponse,
    AuditRulePackageRecord,
    AuditTemplateCreateRequest,
    AuditTemplateListResponse,
    AuditTemplateResponse,
    AuditTemplateUpdateRequest,
    CurrentUser,
    SystemHardRuleItem,
    SystemHardRulesResponse,
)
from app.services.runtime_store import RuntimeStore


SYSTEM_HARD_RULES = SystemHardRulesResponse(
    title="系统硬规则",
    description="固定启用，不可关闭。",
    version=1,
    rules=[
        SystemHardRuleItem(
            code="evidence_only",
            title="基于明确证据",
            content="审核结论必须基于上传单据中的明确证据，不得猜测或编造。",
        ),
        SystemHardRuleItem(
            code="simplified_chinese",
            title="简体中文输出",
            content="用户可见输出必须使用简体中文。",
        ),
        SystemHardRuleItem(
            code="fixed_risk_levels",
            title="固定风险等级",
            content="风险等级必须固定为红色·高风险、黄色·疑点、蓝色·提示。",
        ),
        SystemHardRuleItem(
            code="merge_duplicates",
            title="合并重复问题",
            content="相同或高度重复的问题必须合并输出，避免重复刷屏。",
        ),
        SystemHardRuleItem(
            code="manual_review_when_unclear",
            title="无法确认需复核",
            content="无法确认的问题必须标记为需人工复核，不得直接下确定结论。",
        ),
        SystemHardRuleItem(
            code="no_pass_without_evidence",
            title="缺少证据不默认通过",
            content="不得因为缺少证据而默认判定为通过。",
        ),
        SystemHardRuleItem(
            code="priority_fields",
            title="优先审核字段",
            content="金额、数量、日期、主体、货品信息属于优先审核字段。",
        ),
        SystemHardRuleItem(
            code="stable_results",
            title="审核结果稳定",
            content="审核结果应尽量稳定，同一文件同一规则下不应大幅随机变化。",
        ),
    ],
)


FALLBACK_RULE_PACKAGES = [
    {
        "id": "base_common_v1",
        "code": "base_common_v1",
        "name": "基础通用规则包",
        "description": "所有单据审核默认启用，不区分内贸或外贸。",
        "business_type": None,
        "package_type": "base_common",
        "version": 1,
        "rules": [
            "金额是否一致",
            "数量是否一致",
            "日期逻辑是否合理",
            "买卖双方信息是否一致",
            "单据编号是否缺失",
            "商品名称、规格、单位是否冲突",
            "关键字段是否存在异常",
            "缺失字段、冲突字段、异常字段要提示人工复核",
        ],
        "is_active": True,
        "created_at": None,
        "updated_at": None,
    },
    {
        "id": "domestic_v1",
        "code": "domestic_v1",
        "name": "内贸规则包",
        "description": "适用于国内订单、国内合同、增值税发票、送货单、对账单、采购单、销售单。",
        "business_type": "domestic",
        "package_type": "business",
        "version": 1,
        "rules": [
            "公司名称",
            "统一社会信用代码",
            "开票信息",
            "含税金额、未税金额、税率、税额",
            "送货数量、签收数量、开票数量",
            "付款条件、账期、结算方式",
            "收货地址、联系人、电话",
        ],
        "is_active": True,
        "created_at": None,
        "updated_at": None,
    },
    {
        "id": "foreign_v1",
        "code": "foreign_v1",
        "name": "外贸规则包",
        "description": "适用于 PO、PI、Commercial Invoice、Packing List、B/L、出口合同、报关资料。",
        "business_type": "foreign",
        "package_type": "business",
        "version": 1,
        "rules": [
            "Buyer / Seller / Consignee / Notify Party",
            "Incoterms",
            "目的港、装运港、交货期",
            "币种、金额、数量、单价",
            "箱数、毛重、净重、体积",
            "英文品名、规格、型号、HS Code",
            "外贸付款方式、信用证、唛头、运输方式",
        ],
        "is_active": True,
        "created_at": None,
        "updated_at": None,
    },
]


class TemplateLibraryService:
    """Service for the new backend template library surface."""

    def __init__(self, store: RuntimeStore, repo: SupabaseRepository | None = None) -> None:
        self.store = store
        self.repo = repo

    def get_system_hard_rules(self) -> SystemHardRulesResponse:
        return SYSTEM_HARD_RULES

    def list_rule_packages(self) -> AuditRulePackageListResponse:
        records = self.repo.list_rule_packages() if self.repo is not None else FALLBACK_RULE_PACKAGES
        packages = [AuditRulePackageRecord.model_validate(record) for record in records]
        packages.sort(key=lambda item: (0 if item.package_type == "base_common" else 1, item.code))
        return AuditRulePackageListResponse(packages=packages)

    def list_templates(self, current_user: CurrentUser) -> AuditTemplateListResponse:
        records = (
            self.repo.list_audit_templates(current_user.id)
            if self.repo is not None
            else [
                template
                for template in self.store.audit_templates.values()
                if str(template.get("user_id")) == current_user.id
            ]
        )
        templates = [self._to_template_response(record) for record in records]
        templates.sort(
            key=lambda item: (item.updated_at or item.created_at).isoformat()
            if item.updated_at or item.created_at
            else "",
            reverse=True,
        )
        templates.sort(key=lambda item: not item.is_default)
        return AuditTemplateListResponse(templates=templates)

    def create_template(
        self,
        current_user: CurrentUser,
        payload: AuditTemplateCreateRequest,
    ) -> AuditTemplateResponse:
        now = datetime.now(timezone.utc)
        record = {
            "id": str(uuid4()),
            "user_id": current_user.id,
            "name": payload.name,
            "description": payload.description or "",
            "business_type": payload.business_type,
            "supplemental_rules": payload.supplemental_rules or "",
            "is_default": payload.is_default,
            "created_at": now,
            "updated_at": now,
        }
        if payload.is_default:
            self._clear_default_templates(current_user.id)

        if self.repo is not None:
            record = self.repo.create_audit_template(current_user.id, record)
        else:
            self.store.audit_templates[str(record["id"])] = record
        return self._to_template_response(record)

    def get_template(self, current_user: CurrentUser, template_id: str) -> AuditTemplateResponse:
        return self._to_template_response(self._get_owned_template(current_user.id, template_id))

    def update_template(
        self,
        current_user: CurrentUser,
        template_id: str,
        payload: AuditTemplateUpdateRequest,
    ) -> AuditTemplateResponse:
        existing = self._get_owned_template(current_user.id, template_id)
        updates = payload.model_dump(exclude_unset=True)
        if not updates:
            return self._to_template_response(existing)

        if updates.get("is_default") is True:
            self._clear_default_templates(current_user.id)

        updates["updated_at"] = datetime.now(timezone.utc)
        if self.repo is not None:
            updated = self.repo.update_audit_template(template_id, current_user.id, updates)
        else:
            existing.update(updates)
            self.store.audit_templates[template_id] = existing
            updated = existing
        return self._to_template_response(updated)

    def delete_template(self, current_user: CurrentUser, template_id: str) -> None:
        self._get_owned_template(current_user.id, template_id)
        if self.repo is not None:
            self.repo.delete_audit_template(template_id, current_user.id)
        self.store.audit_templates.pop(template_id, None)

    def duplicate_template(self, current_user: CurrentUser, template_id: str) -> AuditTemplateResponse:
        source = self._get_owned_template(current_user.id, template_id)
        now = datetime.now(timezone.utc)
        record = {
            "id": str(uuid4()),
            "user_id": current_user.id,
            "name": f"{source['name']} 副本",
            "description": source.get("description", ""),
            "business_type": source["business_type"],
            "supplemental_rules": source.get("supplemental_rules", ""),
            "is_default": False,
            "created_at": now,
            "updated_at": now,
        }
        if self.repo is not None:
            record = self.repo.create_audit_template(current_user.id, record)
        else:
            self.store.audit_templates[str(record["id"])] = record
        return self._to_template_response(record)

    def set_default_template(self, current_user: CurrentUser, template_id: str) -> AuditTemplateResponse:
        self._get_owned_template(current_user.id, template_id)
        self._clear_default_templates(current_user.id)
        updates = {"is_default": True, "updated_at": datetime.now(timezone.utc)}
        if self.repo is not None:
            updated = self.repo.update_audit_template(template_id, current_user.id, updates)
        else:
            template = self.store.audit_templates[template_id]
            template.update(updates)
            updated = template
        return self._to_template_response(updated)

    def _get_owned_template(self, user_id: str, template_id: str) -> dict[str, object]:
        template = (
            self.repo.get_audit_template(template_id, user_id)
            if self.repo is not None
            else self.store.audit_templates.get(template_id)
        )
        if template is None or str(template.get("user_id")) != user_id:
            raise AppError("未找到指定模板，或你无权访问该模板。", status_code=404)
        return template

    def _clear_default_templates(self, user_id: str) -> None:
        if self.repo is not None:
            self.repo.clear_default_audit_templates(user_id)
            return
        now = datetime.now(timezone.utc)
        for template in self.store.audit_templates.values():
            if str(template.get("user_id")) == user_id:
                template["is_default"] = False
                template["updated_at"] = now

    @staticmethod
    def _to_template_response(template: dict[str, object]) -> AuditTemplateResponse:
        return AuditTemplateResponse(
            id=str(template["id"]),
            user_id=str(template["user_id"]),
            name=str(template["name"]),
            description=str(template.get("description") or ""),
            business_type=template["business_type"],  # type: ignore[arg-type]
            supplemental_rules=str(template.get("supplemental_rules") or ""),
            is_default=bool(template.get("is_default", False)),
            created_at=template.get("created_at"),  # type: ignore[arg-type]
            updated_at=template.get("updated_at"),  # type: ignore[arg-type]
        )
