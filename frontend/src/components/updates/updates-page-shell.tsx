"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Megaphone, RefreshCcw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getAnnouncementCategoryLabel,
  getAnnouncements,
  type AnnouncementItem
} from "@/lib/api/announcements";
import { getStoredAccessToken } from "@/lib/api";
import { markAnnouncementAsSeen } from "@/lib/announcement-seen";

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
        error={error}
        onRetry={() => {
          if (token) {
            void loadAnnouncements(token);
          }
        }}
      />
    </section>
  );
}

function UpdatesContent({
  status,
  announcements,
  error,
  onRetry
}: {
  status: LoadStatus;
  announcements: AnnouncementItem[];
  error: string | null;
  onRetry: () => void;
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

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="inverse">
          <Megaphone size={14} strokeWidth={3} />
          已发布
        </Badge>
        <p className="text-sm font-black leading-6 md:text-base">
          当前共 {announcements.length} 条平台更新公告
        </p>
      </div>

      <div className="space-y-5">
        {announcements.map((announcement) => (
          <Card key={announcement.id} className="bg-paper">
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  {getAnnouncementCategoryLabel(announcement.category)}
                </Badge>
                <CardDescription>发布时间：{formatDate(announcement.published_at)}</CardDescription>
              </div>
              <CardTitle>{announcement.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap break-words text-sm font-bold leading-6 md:text-base">
                {announcement.content}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
