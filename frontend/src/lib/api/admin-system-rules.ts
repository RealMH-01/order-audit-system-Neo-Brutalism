import { apiGet, apiPatch, apiPost } from "@/lib/api";

export type SystemRuleChangeAction =
  | "create"
  | "update"
  | "enable"
  | "disable"
  | "reorder"
  | "restore";

export type SystemRuleAdminItem = {
  id: string;
  code: string;
  title: string;
  content: string;
  is_enabled: boolean;
  sort_order: number;
  created_at?: string | null;
  updated_at?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
};

export type SystemRuleChangeLog = {
  id: string;
  rule_id?: string | null;
  rule_code_snapshot: string;
  action: SystemRuleChangeAction;
  old_value?: Record<string, unknown> | null;
  new_value?: Record<string, unknown> | null;
  reason: string;
  summary?: string | null;
  changed_by: string;
  changed_by_email?: string | null;
  changed_at?: string | null;
};

export type CreateSystemRulePayload = {
  title: string;
  content: string;
  sort_order?: number;
  is_enabled: boolean;
  reason: string;
};

export type UpdateSystemRulePayload = {
  title?: string;
  content?: string;
  sort_order?: number;
  is_enabled?: boolean;
  reason: string;
};

const adminRequestOptions = (token: string) => ({
  token,
  redirectOnAuthError: false
});

export async function getAdminSystemRules(token: string) {
  const { data } = await apiGet<SystemRuleAdminItem[]>("/admin/system-rules", adminRequestOptions(token));
  return data;
}

export async function createAdminSystemRule(token: string, payload: CreateSystemRulePayload) {
  const { data } = await apiPost<SystemRuleAdminItem>(
    "/admin/system-rules",
    payload,
    adminRequestOptions(token)
  );
  return data;
}

export async function updateAdminSystemRule(
  token: string,
  ruleId: string,
  payload: UpdateSystemRulePayload
) {
  const { data } = await apiPatch<SystemRuleAdminItem>(
    `/admin/system-rules/${ruleId}`,
    payload,
    adminRequestOptions(token)
  );
  return data;
}

export async function getAdminSystemRuleChangeLogs(token: string, ruleId?: string | null) {
  const params = new URLSearchParams({ limit: "50" });
  if (ruleId) {
    params.set("rule_id", ruleId);
  }

  const { data } = await apiGet<SystemRuleChangeLog[]>(
    `/admin/system-rules/change-logs?${params.toString()}`,
    adminRequestOptions(token)
  );
  return data;
}
