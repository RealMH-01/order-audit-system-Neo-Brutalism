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
