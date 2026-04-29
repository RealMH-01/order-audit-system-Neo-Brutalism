import { apiGet, apiPatch, apiPost } from "@/lib/api";
import type { AnnouncementCategory, AnnouncementItem } from "@/lib/api/announcements";

export type CreateAdminAnnouncementPayload = {
  title: string;
  content: string;
  category: AnnouncementCategory;
  is_published: boolean;
};

export type AdminAnnouncementItem = AnnouncementItem & {
  is_published: boolean;
  created_by?: string | null;
  updated_by?: string | null;
};

export type UpdateAdminAnnouncementPayload = {
  title?: string;
  content?: string;
  category?: AnnouncementCategory;
  is_published?: boolean;
};

const adminRequestOptions = (token: string) => ({
  token,
  redirectOnAuthError: false
});

export async function getAdminAnnouncements(token: string) {
  const { data } = await apiGet<AdminAnnouncementItem[]>(
    "/admin/announcements",
    adminRequestOptions(token)
  );
  return data;
}

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

export async function updateAdminAnnouncement(
  token: string,
  announcementId: string,
  payload: UpdateAdminAnnouncementPayload
) {
  const { data } = await apiPatch<AdminAnnouncementItem>(
    `/admin/announcements/${announcementId}`,
    payload,
    adminRequestOptions(token)
  );
  return data;
}
