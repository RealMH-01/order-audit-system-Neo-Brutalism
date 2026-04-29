"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { FilePlus2, Loader2, Megaphone, PenLine, RefreshCcw, ShieldAlert } from "lucide-react";

import { AnnouncementEditorDialog } from "@/components/admin/announcement-editor-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getAdminAnnouncements,
  type AdminAnnouncementItem
} from "@/lib/api/admin-announcements";
import { getAnnouncementCategoryLabel } from "@/lib/api/announcements";
import { getStoredAccessToken } from "@/lib/api";
import { normalizeApiErrorDetail } from "@/lib/api-error";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

type Feedback = {
  tone: "success" | "error";
  message: string;
};

type EditorMode = "create" | "edit";

function getErrorStatus(error: unknown) {
  if (typeof error === "object" && error && "status" in error) {
    const status = Number(error.status);
    return Number.isFinite(status) ? status : null;
  }
  return null;
}

function normalizeAnnouncementAdminError(error: unknown, fallback: string) {
  const status = getErrorStatus(error);
  if (status === 401) {
    return "登录过期，请重新登录后再管理公告。";
  }
  if (status === 403) {
    return "当前账号不是管理员，不能管理公告。";
  }
  if (status === 400) {
    return normalizeApiErrorDetail(error, fallback);
  }
  return fallback;
}

function formatDate(value?: string | null) {
  if (!value) {
    return "暂无";
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

function getSummary(content: string) {
  const trimmed = content.trim();
  if (trimmed.length <= 180) {
    return trimmed;
  }
  return `${trimmed.slice(0, 180)}...`;
}

function Notice({ tone, message }: Feedback) {
  return (
    <div className={cn(tone === "success" ? "issue-blue" : "issue-red", "p-4")}>
      <p className="text-sm font-black leading-6">{message}</p>
    </div>
  );
}

export function AnnouncementsAdminShell() {
  const { state: authState } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [announcements, setAnnouncements] = useState<AdminAnnouncementItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>("create");
  const [editingAnnouncement, setEditingAnnouncement] = useState<AdminAnnouncementItem | null>(null);

  const isAdmin = authState.user?.role === "admin";
  const publishedCount = useMemo(
    () => announcements.filter((announcement) => announcement.is_published).length,
    [announcements]
  );
  const draftCount = announcements.length - publishedCount;

  const loadAnnouncements = useCallback(
    async (accessToken: string, clearFeedback = true) => {
      setLoading(true);
      setLoadError(null);
      if (clearFeedback) {
        setFeedback(null);
      }

      try {
        const nextAnnouncements = await getAdminAnnouncements(accessToken);
        setAnnouncements(nextAnnouncements);
      } catch (error) {
        setAnnouncements([]);
        setLoadError(normalizeAnnouncementAdminError(error, "公告列表读取失败，请稍后重试。"));
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    const accessToken = getStoredAccessToken();
    setToken(accessToken);

    if (!accessToken || !isAdmin) {
      setLoading(false);
      return;
    }

    void loadAnnouncements(accessToken);
  }, [isAdmin, loadAnnouncements]);

  const openCreateDialog = () => {
    setEditorMode("create");
    setEditingAnnouncement(null);
    setFeedback(null);
    setEditorOpen(true);
  };

  const openEditDialog = (announcement: AdminAnnouncementItem) => {
    setEditorMode("edit");
    setEditingAnnouncement(announcement);
    setFeedback(null);
    setEditorOpen(true);
  };

  const handleSaved = (message: string) => {
    setFeedback({ tone: "success", message });
    setEditorOpen(false);
    if (token) {
      void loadAnnouncements(token, false);
    }
  };

  if (!isAdmin) {
    return (
      <section className="space-y-6">
        <HeaderBlock />
        <Card className="bg-acid">
          <CardHeader>
            <Badge variant="inverse">
              <ShieldAlert size={14} strokeWidth={3} />
              无权限
            </Badge>
            <CardTitle>无权限访问公告管理</CardTitle>
            <CardDescription>
              当前账号不是管理员，不能查看、编辑、发布或取消发布公告。真正权限以后端 403 为准。
            </CardDescription>
          </CardHeader>
        </Card>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="space-y-6">
        <HeaderBlock />
        <Card className="bg-paper">
          <CardContent className="flex items-center gap-3 py-10">
            <Loader2 className="animate-spin" size={20} strokeWidth={3} />
            <p className="text-sm font-black uppercase tracking-[0.14em]">
              正在读取公告列表
            </p>
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section className="space-y-8">
      <HeaderBlock
        action={
          <>
            <Button
              variant="outline"
              onClick={() => {
                if (token) {
                  void loadAnnouncements(token);
                }
              }}
            >
              <RefreshCcw size={18} strokeWidth={3} />
              刷新
            </Button>
            <Button onClick={openCreateDialog}>
              <FilePlus2 size={18} strokeWidth={3} />
              新建公告
            </Button>
          </>
        }
      />

      {loadError ? <Notice tone="error" message={loadError} /> : null}
      {feedback ? <Notice tone={feedback.tone} message={feedback.message} /> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="inverse">
          <Megaphone size={14} strokeWidth={3} />
          全部 {announcements.length}
        </Badge>
        <Badge variant="secondary">已发布 {publishedCount}</Badge>
        <Badge variant="muted">草稿 {draftCount}</Badge>
      </div>

      {announcements.length > 0 ? (
        <section className="space-y-5">
          {announcements.map((announcement) => (
            <AnnouncementCard
              key={announcement.id}
              announcement={announcement}
              onEdit={() => openEditDialog(announcement)}
            />
          ))}
        </section>
      ) : (
        <Card className="bg-muted">
          <CardContent className="py-8">
            <p className="text-sm font-black leading-6">
              还没有公告，可以先新建一条草稿或发布公告。
            </p>
          </CardContent>
        </Card>
      )}

      <AnnouncementEditorDialog
        open={editorOpen}
        token={token}
        mode={editorMode}
        initialAnnouncement={editingAnnouncement}
        onClose={() => setEditorOpen(false)}
        onSaved={handleSaved}
      />
    </section>
  );
}

function HeaderBlock({ action }: { action?: ReactNode }) {
  return (
    <header className="border-4 border-ink bg-paper p-6 shadow-neo-lg md:p-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-4">
          <Badge variant="secondary" className="-rotate-1">
            Admin
          </Badge>
          <div className="space-y-3">
            <h1 className="max-w-5xl text-4xl font-black uppercase leading-none tracking-tight md:text-6xl">
              公告管理
            </h1>
            <p className="max-w-4xl text-base font-bold leading-7 md:text-lg">
              管理平台更新公告、草稿和发布状态。
            </p>
          </div>
        </div>
        {action ? <div className="flex flex-wrap gap-3">{action}</div> : null}
      </div>
    </header>
  );
}

function AnnouncementCard({
  announcement,
  onEdit
}: {
  announcement: AdminAnnouncementItem;
  onEdit: () => void;
}) {
  return (
    <Card className={cn(announcement.is_published ? "bg-paper" : "bg-muted")}>
      <CardHeader>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={announcement.is_published ? "inverse" : "neutral"}>
                {announcement.is_published ? "已发布" : "草稿"}
              </Badge>
              <Badge variant="secondary">
                {getAnnouncementCategoryLabel(announcement.category)}
              </Badge>
            </div>
            <CardTitle>{announcement.title}</CardTitle>
            <div className="grid gap-1 text-sm font-bold leading-6 md:grid-cols-2">
              <p>创建时间：{formatDate(announcement.created_at)}</p>
              <p>更新时间：{formatDate(announcement.updated_at)}</p>
              {announcement.published_at ? (
                <p>发布时间：{formatDate(announcement.published_at)}</p>
              ) : null}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={onEdit}>
            <PenLine size={16} strokeWidth={3} />
            编辑
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="border-4 border-ink bg-canvas p-4 shadow-neo-sm">
          <p className="whitespace-pre-wrap break-words text-sm font-bold leading-6">
            {getSummary(announcement.content)}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
