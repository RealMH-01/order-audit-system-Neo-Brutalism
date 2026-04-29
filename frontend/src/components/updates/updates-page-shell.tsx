"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { EyeOff, Loader2, Megaphone, RefreshCcw, Undo2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getAnnouncementCategoryLabel,
  getAnnouncements,
  type AnnouncementItem
} from "@/lib/api/announcements";
import { getStoredAccessToken } from "@/lib/api";
import {
  getHiddenAnnouncementIds,
  hideAnnouncement,
  markAnnouncementAsSeen,
  restoreAnnouncement
} from "@/lib/announcement-seen";

type LoadStatus = "idle" | "loading" | "success" | "error";

function formatDate(value?: string | null) {
  if (!value) {
    return "暂未发布";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function UpdatesPageShell() {
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
  const [hiddenAnnouncementIds, setHiddenAnnouncementIds] = useState<string[]>([]);
  const [showHiddenAnnouncements, setShowHiddenAnnouncements] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAnnouncements = useCallback(async (accessToken: string) => {
    setStatus("loading");
    setError(null);

    try {
      const nextAnnouncements = await getAnnouncements(accessToken);
      setAnnouncements(nextAnnouncements);
      setStatus("success");
    } catch {
      setAnnouncements([]);
      setError("平台更新公告读取失败，请稍后重试。");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    const accessToken = getStoredAccessToken();
    setToken(accessToken);
    setHiddenAnnouncementIds(getHiddenAnnouncementIds());

    if (!accessToken) {
      setError("请先登录后再查看平台更新。");
      setStatus("error");
      return;
    }

    void loadAnnouncements(accessToken);
  }, [loadAnnouncements]);

  useEffect(() => {
    if (status !== "success") {
      return;
    }

    const latest = announcements[0];
    if (latest) {
      markAnnouncementAsSeen(latest);
    }
  }, [announcements, status]);

  return (
    <section className="space-y-8">
      <header className="border-4 border-ink bg-paper p-6 shadow-neo-lg md:p-8">
        <div className="space-y-4">
          <Badge variant="secondary" className="-rotate-1">
            Updates
          </Badge>
          <div className="space-y-3">
            <h1 className="max-w-4xl text-4xl font-black uppercase leading-none tracking-tight md:text-6xl">
              平台更新
            </h1>
            <p className="max-w-3xl text-base font-bold leading-7 md:text-lg">
              这里展示平台规则变化、功能更新和重要说明。
            </p>
          </div>
        </div>
      </header>

      <UpdatesContent
        status={status}
        announcements={announcements}
        hiddenAnnouncementIds={hiddenAnnouncementIds}
        showHiddenAnnouncements={showHiddenAnnouncements}
        error={error}
        onRetry={() => {
          if (token) {
            void loadAnnouncements(token);
          }
        }}
        onToggleHiddenAnnouncements={() => setShowHiddenAnnouncements((value) => !value)}
        onHideAnnouncement={(announcementId) => {
          hideAnnouncement(announcementId);
          setHiddenAnnouncementIds(getHiddenAnnouncementIds());
        }}
        onRestoreAnnouncement={(announcementId) => {
          restoreAnnouncement(announcementId);
          setHiddenAnnouncementIds(getHiddenAnnouncementIds());
        }}
      />
    </section>
  );
}

function UpdatesContent({
  status,
  announcements,
  hiddenAnnouncementIds,
  showHiddenAnnouncements,
  error,
  onRetry,
  onToggleHiddenAnnouncements,
  onHideAnnouncement,
  onRestoreAnnouncement
}: {
  status: LoadStatus;
  announcements: AnnouncementItem[];
  hiddenAnnouncementIds: string[];
  showHiddenAnnouncements: boolean;
  error: string | null;
  onRetry: () => void;
  onToggleHiddenAnnouncements: () => void;
  onHideAnnouncement: (announcementId: string) => void;
  onRestoreAnnouncement: (announcementId: string) => void;
}) {
  if (status === "loading" || status === "idle") {
    return (
      <Card className="bg-secondary">
        <CardContent className="flex items-center gap-3 py-8">
          <Loader2 className="animate-spin" size={20} strokeWidth={3} />
          <p className="text-sm font-black uppercase tracking-[0.14em]">
            正在读取平台更新公告……
          </p>
        </CardContent>
      </Card>
    );
  }

  if (status === "error") {
    return (
      <div className="issue-red p-4">
        <p className="text-sm font-black leading-6">
          {error ?? "平台更新公告读取失败，请稍后重试。"}
        </p>
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-3">
          <RefreshCcw size={16} strokeWidth={3} />
          重新读取
        </Button>
      </div>
    );
  }

  if (announcements.length === 0) {
    return (
      <Card className="bg-muted">
        <CardContent className="py-8">
          <p className="text-sm font-black leading-6">暂无平台更新公告</p>
        </CardContent>
      </Card>
    );
  }

  const visibleAnnouncements = announcements.filter(
    (announcement) => !hiddenAnnouncementIds.includes(announcement.id)
  );
  const hiddenAnnouncements = announcements.filter((announcement) =>
    hiddenAnnouncementIds.includes(announcement.id)
  );
  const displayedAnnouncements = showHiddenAnnouncements ? hiddenAnnouncements : visibleAnnouncements;

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="inverse">
          <Megaphone size={14} strokeWidth={3} />
          {showHiddenAnnouncements ? "已收起" : "已发布"}
        </Badge>
        <p className="text-sm font-black leading-6 md:text-base">
          {showHiddenAnnouncements
            ? `当前共 ${hiddenAnnouncements.length} 条已收起公告`
            : `当前共 ${visibleAnnouncements.length} 条平台更新公告`}
        </p>
        <Button variant="outline" size="sm" onClick={onToggleHiddenAnnouncements}>
          {showHiddenAnnouncements ? (
            <>
              <Undo2 size={16} strokeWidth={3} />
              返回公告列表
            </>
          ) : (
            <>
              <EyeOff size={16} strokeWidth={3} />
              查看已收起公告
            </>
          )}
        </Button>
      </div>

      {displayedAnnouncements.length === 0 ? (
        <Card className="bg-muted">
          <CardContent className="py-8">
            <p className="text-sm font-black leading-6">
              {showHiddenAnnouncements
                ? "暂无已收起公告"
                : "当前公告都已收起，可以查看已收起公告。"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          {displayedAnnouncements.map((announcement) => (
            <AnnouncementCard
              key={announcement.id}
              announcement={announcement}
              actionIcon={
                showHiddenAnnouncements ? (
                  <Undo2 size={16} strokeWidth={3} />
                ) : (
                  <EyeOff size={16} strokeWidth={3} />
                )
              }
              actionLabel={showHiddenAnnouncements ? "恢复显示" : "收起"}
              onAction={() => {
                if (showHiddenAnnouncements) {
                  onRestoreAnnouncement(announcement.id);
                  return;
                }

                onHideAnnouncement(announcement.id);
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function AnnouncementCard({
  announcement,
  actionIcon,
  actionLabel,
  onAction
}: {
  announcement: AnnouncementItem;
  actionIcon: ReactNode;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <Card className="bg-paper">
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                {getAnnouncementCategoryLabel(announcement.category)}
              </Badge>
              <CardDescription>发布时间：{formatDate(announcement.published_at)}</CardDescription>
            </div>
            <CardTitle>{announcement.title}</CardTitle>
          </div>
          <Button variant="outline" size="sm" onClick={onAction} className="w-fit shrink-0">
            {actionIcon}
            {actionLabel}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <p className="whitespace-pre-wrap break-words text-sm font-bold leading-6 md:text-base">
          {announcement.content}
        </p>
      </CardContent>
    </Card>
  );
}
