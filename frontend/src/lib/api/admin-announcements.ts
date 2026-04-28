import { apiPost } from "@/lib/api";
import type { AnnouncementCategory, AnnouncementItem } from "@/lib/api/announcements";

export type CreateAdminAnnouncementPayload = {
  title: string;
  content: string;
  category: AnnouncementCategory;
  is_published: boolean;
};

export type AdminAnnouncementItem = AnnouncementItem & {
  is_published?: boolean;
};

const adminRequestOptions = (token: string) => ({
  token,
  redirectOnAuthError: false
});

export async function createAdminAnnouncement(
  token: string,
  payload: CreateAdminAnnouncementPayload
) {
  const { data } = await apiPost<AdminAnnouncementItem>(
    "/admin/announcements",
    payload,
    adminRequestOptions(token)
  );
  return data;
}
