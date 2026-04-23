import type { WizardProfile } from "@/components/wizard/types";

export type RulesRole = WizardProfile["role"];

export type BuiltinRulePublic = {
  key: string;
  display_text: string;
  updated_at: string | null;
};

export type BuiltinRuleFull = BuiltinRulePublic & {
  prompt_text: string;
};

export type TemplateItem = {
  id: string;
  name: string;
  description: string;
  rules_text: string;
  company_affiliates: string[];
  is_system: boolean;
  user_id: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type BuiltinRuleUpdatePayload = {
  display_text: string;
  prompt_text: string;
};

export type TemplateDraft = {
  name: string;
  description: string;
  rulesText: string;
  companyAffiliatesText: string;
};

export type TemplateMode = "create" | "edit" | "view";

export type TemplateListResponse = {
  templates: TemplateItem[];
};

export type TemplateLoadResponse = {
  template: TemplateItem;
  loaded_rules: string[];
  message: string;
};

export type MessageResponse = {
  message: string;
};

