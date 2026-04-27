import type {
  AuditRulePackage,
  AuditTemplate,
  AuditTemplateDraft,
  TemplateBusinessType
} from "@/components/templates/types";
import { normalizeApiErrorDetail } from "@/lib/api-error";

export function createTemplateDraft(): AuditTemplateDraft {
  return {
    name: "通用单据审核模板",
    description: "",
    business_type: "domestic",
    supplemental_rules: ""
  };
}

export function toTemplateDraft(template: AuditTemplate): AuditTemplateDraft {
  return {
    name: template.name,
    description: template.description,
    business_type: template.business_type,
    supplemental_rules: template.supplemental_rules
  };
}

export function resolveBusinessTypeLabel(type: TemplateBusinessType | null) {
  if (type === "domestic") {
    return "内贸";
  }

  if (type === "foreign") {
    return "外贸";
  }

  return "全部场景";
}

export function resolvePackageTone(packageItem: AuditRulePackage) {
  if (packageItem.package_type === "base_common") {
    return "bg-secondary";
  }

  return packageItem.business_type === "domestic" ? "bg-muted" : "bg-acid";
}

export function sortTemplates(templates: AuditTemplate[]) {
  return [...templates].sort((left, right) => {
    if (left.is_default !== right.is_default) {
      return left.is_default ? -1 : 1;
    }

    const leftTime = new Date(left.updated_at ?? left.created_at ?? 0).getTime();
    const rightTime = new Date(right.updated_at ?? right.created_at ?? 0).getTime();
    if (leftTime !== rightTime) {
      return rightTime - leftTime;
    }

    return left.name.localeCompare(right.name, "zh-CN");
  });
}

export function formatTemplateDate(value: string | null) {
  if (!value) {
    return "暂无时间";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "暂无时间";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function summarizeSupplementalRules(rules: string) {
  const normalized = rules.trim();
  if (!normalized) {
    return "暂未填写补充规则。";
  }

  const firstLines = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3);

  return firstLines.join(" / ");
}

export function normalizeTemplateError(error: unknown, fallback: string) {
  return normalizeApiErrorDetail(error, fallback);
}
