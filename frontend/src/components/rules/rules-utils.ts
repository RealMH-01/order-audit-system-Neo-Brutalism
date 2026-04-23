import type { RulesRole, TemplateDraft, TemplateItem, TemplateMode } from "@/components/rules/types";

export function normalizeError(error: unknown, fallback: string) {
  if (typeof error === "object" && error && "detail" in error) {
    return String(error.detail);
  }

  return fallback;
}

export function formatRulesDate(value: string | null) {
  if (!value) {
    return "后端未返回时间";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "时间格式不可用";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function createEmptyTemplateDraft(): TemplateDraft {
  return {
    name: "",
    description: "",
    rulesText: "",
    companyAffiliatesText: ""
  };
}

export function toTemplateDraft(template: TemplateItem): TemplateDraft {
  return {
    name: template.name,
    description: template.description,
    rulesText: template.rules_text,
    companyAffiliatesText: template.company_affiliates.join("\n")
  };
}

export function parseAffiliateLines(text: string) {
  return text
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function resolveTemplateMode(
  template: TemplateItem | null,
  role: RulesRole | null,
  currentUserId: string | null
): TemplateMode {
  if (!template) {
    return "create";
  }

  if (canEditTemplate(template, role, currentUserId)) {
    return "edit";
  }

  return "view";
}

export function canEditTemplate(
  template: TemplateItem,
  role: RulesRole | null,
  currentUserId: string | null
) {
  if (template.is_system) {
    return role === "admin";
  }

  return template.user_id === currentUserId;
}

export function canDeleteTemplate(
  template: TemplateItem,
  role: RulesRole | null,
  currentUserId: string | null
) {
  return canEditTemplate(template, role, currentUserId);
}

export function resolveTemplateScopeLabel(template: TemplateItem, currentUserId: string | null) {
  if (template.is_system) {
    return "系统模板";
  }

  if (template.user_id === currentUserId) {
    return "我的模板";
  }

  return "用户模板";
}

export function sortTemplates(templates: TemplateItem[]) {
  return [...templates].sort((left, right) => {
    if (left.is_system !== right.is_system) {
      return left.is_system ? -1 : 1;
    }

    const leftUpdated = left.updated_at ? new Date(left.updated_at).getTime() : 0;
    const rightUpdated = right.updated_at ? new Date(right.updated_at).getTime() : 0;
    if (leftUpdated !== rightUpdated) {
      return rightUpdated - leftUpdated;
    }

    return left.name.localeCompare(right.name, "zh-CN");
  });
}
