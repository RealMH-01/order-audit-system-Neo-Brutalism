"""Backend foundation for fixed audit rules and user templates."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from app.db.repository import SupabaseRepository
from app.errors import AppError
from app.models.schemas import (
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
        SystemHardRuleItem(
            code="fuzzy_id_matching",
            title="编号模糊匹配与录入错误识别",
            content=(
                "当目标单据缺少某个编号字段（如合同号、PO号）时，必须主动检查目标单据中其他编号字段"
                "（如发票号、PO号、提单号）是否与该缺失编号高度相似——即其余部分完全一致、仅差一位数字或多/少一个字符。"
                "如发现此类高度相似情况，应判定为RED·高风险，明确指出疑似录入错误或编号混用，"
                "说明具体差异（如'HR-EXP250401 疑似为 HR-EXP2504001 的录入错误，末尾缺少一位0'），"
                "而非简单报告为'该字段缺失'。"
                "注意：仅在其余部分完全一致且差异极小时才做此判定，避免将两个独立编号误判为录入错误。"
            ),
        ),
        SystemHardRuleItem(
            code="invoice_no_equals_contract_no",
            title="发票号与合同号相同属于正常业务惯例",
            content=(
                "在部分业务场景中，Commercial Invoice（CI）和 Packing List（PL）上的发票号"
                "与 PO/合同中的合同号是同一个编号，这是允许且常见的业务惯例，不属于编号混用或录入错误。"
                "当目标单据的发票号与 PO 的合同号完全一致时，不应标记为风险问题。"
                "仅当发票号与合同号存在实际差异（如少字符、多字符、数字不同）时，才应按差异程度标记为 RED 或 YELLOW。"
            ),
        ),
    ],
)



@dataclass(frozen=True)
class ResolvedAuditTemplateRules:
    """Resolved audit-rule text for one audit run."""

    template: AuditTemplateResponse | None
    rules_text: str
    rule_snapshot: dict[str, Any]


class TemplateLibraryService:
    """Service for the new backend template library surface."""

    def __init__(self, store: RuntimeStore, repo: SupabaseRepository | None = None) -> None:
        self.store = store
        self.repo = repo

    def get_system_hard_rules(self) -> SystemHardRulesResponse:
        return SYSTEM_HARD_RULES

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

    def resolve_audit_rules_for_run(
        self,
        current_user: CurrentUser,
        template_id: str | None = None,
        temporary_rules: list[str] | None = None,
    ) -> ResolvedAuditTemplateRules:
        """Resolve the actual audit-rule stack used by an audit run."""

        selected_template = self._resolve_template_for_run(current_user.id, template_id)
        sections = [self._format_system_hard_rules()]

        if selected_template is not None:
            if selected_template.supplemental_rules.strip():
                sections.append(f"【模板补充规则】\n{selected_template.supplemental_rules.strip()}")

        clean_temporary_rules = [
            rule.strip()
            for rule in (temporary_rules or [])
            if isinstance(rule, str) and rule.strip()
        ]
        if clean_temporary_rules:
            sections.append(
                "【本轮临时补充规则】\n"
                + "\n".join(f"- {rule}" for rule in clean_temporary_rules)
            )

        return ResolvedAuditTemplateRules(
            template=selected_template,
            rules_text="\n\n".join(section for section in sections if section.strip()),
            rule_snapshot=self._build_rule_snapshot(
                selected_template=selected_template,
                temporary_rules=clean_temporary_rules,
            ),
        )

    def _get_owned_template(self, user_id: str, template_id: str) -> dict[str, object]:
        template = (
            self.repo.get_audit_template(template_id, user_id)
            if self.repo is not None
            else self.store.audit_templates.get(template_id)
        )
        if template is None or str(template.get("user_id")) != user_id:
            raise AppError("未找到指定模板，或你无权访问该模板。", status_code=404)
        return template

    def _resolve_template_for_run(
        self,
        user_id: str,
        template_id: str | None,
    ) -> AuditTemplateResponse | None:
        clean_template_id = (template_id or "").strip()
        if clean_template_id:
            return self._to_template_response(self._get_owned_template(user_id, clean_template_id))

        default_template = self._get_default_template(user_id)
        if default_template is None:
            return None
        return self._to_template_response(default_template)

    def _get_default_template(self, user_id: str) -> dict[str, object] | None:
        templates = (
            self.repo.list_audit_templates(user_id)
            if self.repo is not None
            else [
                template
                for template in self.store.audit_templates.values()
                if str(template.get("user_id")) == user_id
            ]
        )
        for template in templates:
            if bool(template.get("is_default", False)):
                return template
        return None

    @staticmethod
    def _format_system_hard_rules() -> str:
        lines = [
            f"- {rule.title}：{rule.content}"
            for rule in SYSTEM_HARD_RULES.rules
        ]
        return "【系统硬规则】\n" + "\n".join(lines)

    def _build_rule_snapshot(
        self,
        *,
        selected_template: AuditTemplateResponse | None,
        temporary_rules: list[str],
    ) -> dict[str, Any]:
        resolved_sections = [
            {
                "title": "系统硬规则",
                "rules": [f"{rule.title}：{rule.content}" for rule in SYSTEM_HARD_RULES.rules],
            },
        ]

        if selected_template is not None and selected_template.supplemental_rules.strip():
            resolved_sections.append(
                {
                    "title": "模板补充规则",
                    "rules": [selected_template.supplemental_rules.strip()],
                }
            )
        if temporary_rules:
            resolved_sections.append(
                {
                    "title": "本轮临时补充规则",
                    "rules": list(temporary_rules),
                }
            )

        return {
            "schema_version": 1,
            "resolved_at": datetime.now(timezone.utc).isoformat(),
            "system_rules": {
                "title": SYSTEM_HARD_RULES.title,
                "version": SYSTEM_HARD_RULES.version,
                "rules": [rule.model_dump(mode="json") for rule in SYSTEM_HARD_RULES.rules],
            },
            "template": self._template_snapshot(selected_template),
            "run_supplemental_rules": list(temporary_rules),
            "resolved_sections": resolved_sections,
        }

    @staticmethod
    def _template_snapshot(template: AuditTemplateResponse | None) -> dict[str, Any] | None:
        if template is None:
            return None
        return {
            "id": template.id,
            "name": template.name,
            "description": template.description,
            "business_type": template.business_type,
            "supplemental_rules": template.supplemental_rules,
            "is_default_at_run": template.is_default,
        }

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
