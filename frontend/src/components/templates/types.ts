export type TemplateBusinessType = "domestic" | "foreign";

export type SystemHardRuleItem = {
  code: string;
  title: string;
  content: string;
};

export type SystemHardRulesResponse = {
  title: string;
  description: string;
  version: number;
  rules: SystemHardRuleItem[];
};

export type AuditRulePackage = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  business_type: TemplateBusinessType | null;
  package_type: "base_common" | "business";
  version: number;
  rules: string[];
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
};

export type AuditRulePackageListResponse = {
  packages: AuditRulePackage[];
};

export type AuditTemplate = {
  id: string;
  user_id: string;
  name: string;
  description: string;
  business_type: TemplateBusinessType;
  supplemental_rules: string;
  is_default: boolean;
  created_at: string | null;
  updated_at: string | null;
};

export type AuditTemplateListResponse = {
  templates: AuditTemplate[];
};

export type AuditTemplateDraft = {
  name: string;
  description: string;
  business_type: TemplateBusinessType;
  supplemental_rules: string;
};

export type MessageResponse = {
  message: string;
};
