import { apiGet } from "@/lib/api";

export const ANNOUNCEMENT_CATEGORY_LABELS = {
  platform_rule: "平台规则",
  feature: "功能更新",
  important: "重要说明",
  maintenance: "维护通知",
  other: "其他"
} as const;

export type AnnouncementCategory = keyof typeof ANNOUNCEMENT_CATEGORY_LABELS;

export type AnnouncementItem = {
  id: string;
  title: string;
  content: string;
  category: AnnouncementCategory;
  published_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export function getAnnouncementCategoryLabel(category: string) {
  return ANNOUNCEMENT_CATEGORY_LABELS[category as AnnouncementCategory] ?? "其他";
}

export async function getAnnouncements(token: string) {
  const { data } = await apiGet<AnnouncementItem[]>("/announcements", {
    token
  });
  return data;
}
