import { apiGet } from "@/lib/api";

export type PublicSystemRuleItem = {
  id: string;
  code: string;
  title: string;
  content: string;
  sort_order: number;
};

export async function getPublicSystemRules(token: string) {
  const { data } = await apiGet<PublicSystemRuleItem[]>("/system-rules", {
    token
  });
  return data;
}
