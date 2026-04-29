import type { AnnouncementItem } from "@/lib/api/announcements";

export const ANNOUNCEMENT_LAST_SEEN_STORAGE_KEY = "order-audit-announcements-last-seen";
export const ANNOUNCEMENT_LAST_SEEN_CHANGED_EVENT = "order-audit-announcements-last-seen-changed";

export function getLatestAnnouncementKey(announcement: AnnouncementItem) {
  const version =
    announcement.published_at ?? announcement.updated_at ?? announcement.created_at ?? announcement.id;

  return `${version}:${announcement.id}`;
}

export function getLastSeenAnnouncementKey() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage.getItem(ANNOUNCEMENT_LAST_SEEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function markAnnouncementAsSeen(announcement: AnnouncementItem) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      ANNOUNCEMENT_LAST_SEEN_STORAGE_KEY,
      getLatestAnnouncementKey(announcement)
    );
    window.dispatchEvent(new Event(ANNOUNCEMENT_LAST_SEEN_CHANGED_EVENT));
  } catch {
    // localStorage can be unavailable in private or restricted browser contexts.
  }
}
