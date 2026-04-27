export type WizardStepKey =
  | "model"
  | "template"
  | "rules"
  | "company"
  | "confirm";

export type WizardProvider = "openai" | "deepseek" | "zhipuai";
export type WizardRuleMode = "ai" | "manual";
export type WizardAuthMode = "login" | "register";
export type WizardCompanyMode = "single" | "group";
export type WizardTemplateOptionId =
  | "generic-order"
  | "generic-trade"
  | "chemical"
  | "blank";

export type WizardTemplateOption = {
  id: WizardTemplateOptionId;
  label: string;
  description: string;
  rulesText: string;
  companyAffiliates: string[];
};

export type WizardMessage = {
  role: "assistant" | "user";
  content: string;
};

export type WizardAffiliateRole = {
  company: string;
  role: string;
};

export type WizardProfile = {
  id: string;
  display_name: string | null;
  selected_model: string;
  deep_think_enabled: boolean;
  company_affiliates: string[];
  company_affiliates_roles: WizardAffiliateRole[];
  active_custom_rules: string[];
  wizard_completed: boolean;
  disclaimer_accepted: boolean;
  role: "user" | "admin";
  has_deepseek_key: boolean;
  has_zhipu_key: boolean;
  has_zhipu_ocr_key: boolean;
  has_openai_key: boolean;
};

export type WizardAuthResponse = {
  access_token: string;
  token_type: "bearer";
  user: {
    id: string;
    email: string;
    display_name?: string | null;
    role?: "user" | "admin";
  };
};

export type WizardConnectionTestResponse = {
  success: boolean;
  message: string;
};

export type WizardStartApiResponse = {
  session_id: string;
  ai_message: string;
  step: string;
  is_complete: boolean;
};

export type WizardChatApiResponse = {
  session_id: string;
  ai_message: string;
  step: string;
  is_complete: boolean;
  generated_rules: string[];
  generated_affiliates: string[];
};

export type WizardCompleteApiResponse = {
  message: string;
  is_complete: boolean;
  generated_rules: string[];
  generated_affiliates: string[];
};

export type WizardFormState = {
  token: string | null;
  authMode: WizardAuthMode;
  email: string;
  password: string;
  provider: WizardProvider;
  selectedModel: string;
  deepThinkEnabled: boolean;
  openaiApiKey: string;
  deepseekApiKey: string;
  zhipuApiKey: string;
  zhipuOcrApiKey: string;
  hasOpenaiKey: boolean;
  hasDeepseekKey: boolean;
  hasZhipuKey: boolean;
  hasZhipuOcrKey: boolean;
  selectedTemplateId: WizardTemplateOptionId;
  ruleMode: WizardRuleMode;
  manualRulesText: string;
  sessionId: string | null;
  chatMessages: WizardMessage[];
  chatInput: string;
  generatedRules: string[];
  generatedAffiliates: string[];
  aiCompleted: boolean;
  aiRulesConfirmed: boolean;
  companyMode: WizardCompanyMode;
  affiliateRoles: WizardAffiliateRole[];
};
