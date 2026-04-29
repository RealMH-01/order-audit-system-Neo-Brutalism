"use client";

import { useEffect, useState } from "react";
import { Loader2, Megaphone, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogSection } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ANNOUNCEMENT_CATEGORY_LABELS,
  type AnnouncementCategory
} from "@/lib/api/announcements";
import {
  createAdminAnnouncement,
  updateAdminAnnouncement,
  type AdminAnnouncementItem
} from "@/lib/api/admin-announcements";
import { normalizeApiErrorDetail } from "@/lib/api-error";

type AnnouncementDraft = {
  title: string;
  content: string;
  category: AnnouncementCategory;
  isPublished: boolean;
};

type AnnouncementEditorMode = "create" | "edit";

const emptyDraft: AnnouncementDraft = {
  title: "",
  content: "",
  category: "platform_rule",
  isPublished: true
};

const categoryOptions = Object.entries(ANNOUNCEMENT_CATEGORY_LABELS) as Array<
  [AnnouncementCategory, string]
>;

function toDraft(announcement: AdminAnnouncementItem | null): AnnouncementDraft {
  if (!announcement) {
    return emptyDraft;
  }

  return {
    title: announcement.title,
    content: announcement.content,
    category: announcement.category,
    isPublished: announcement.is_published
  };
}

function getErrorStatus(error: unknown) {
  if (typeof error === "object" && error && "status" in error) {
    const status = Number(error.status);
    return Number.isFinite(status) ? status : null;
  }
  return null;
}

function normalizeAnnouncementError(error: unknown) {
  const status = getErrorStatus(error);
  if (status === 401) {
    return "登录状态已过期，请重新登录后再发布公告。";
  }
  if (status === 403) {
    return "当前账号没有发布公告权限。";
  }
  if (status === 400) {
    return normalizeApiErrorDetail(error, "公告内容不符合要求，请检查后重试。");
  }
  return "发布公告失败，请稍后重试。";
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="issue-red p-4">
      <p className="text-sm font-black leading-6">{message}</p>
    </div>
  );
}

export function AnnouncementEditorDialog({
  open,
  token,
  onClose,
  onSuccess,
  mode = "create",
  initialAnnouncement = null,
  onSaved
}: {
  open: boolean;
  token: string | null;
  onClose: () => void;
  onSuccess?: (message: string) => void;
  mode?: AnnouncementEditorMode;
  initialAnnouncement?: AdminAnnouncementItem | null;
  onSaved?: (message: string) => void;
}) {
  const [draft, setDraft] = useState<AnnouncementDraft>(() => toDraft(initialAnnouncement));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const isEdit = mode === "edit";

  useEffect(() => {
    if (!open) {
      return;
    }

    setDraft(isEdit ? toDraft(initialAnnouncement) : emptyDraft);
    setError(null);
  }, [initialAnnouncement, isEdit, open]);

  const closeDialog = () => {
    if (!saving) {
      setError(null);
      onClose();
    }
  };

  const saveAnnouncement = async () => {
    if (!token) {
      setError("缺少登录凭证，请重新登录后再发布公告。");
      return;
    }
    if (!draft.title.trim()) {
      setError("公告标题不能为空。");
      return;
    }
    if (!draft.content.trim()) {
      setError("公告正文不能为空。");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (isEdit) {
        if (!initialAnnouncement) {
          setError("缺少要编辑的公告，请刷新列表后重试。");
          return;
        }

        await updateAdminAnnouncement(token, initialAnnouncement.id, {
          title: draft.title.trim(),
          content: draft.content.trim(),
          category: draft.category,
          is_published: draft.isPublished
        });
      } else {
        await createAdminAnnouncement(token, {
          title: draft.title.trim(),
          content: draft.content.trim(),
          category: draft.category,
          is_published: draft.isPublished
        });
        setDraft(emptyDraft);
      }

      const message = isEdit
        ? draft.isPublished
          ? "公告已保存并发布。"
          : "公告已保存为草稿。"
        : draft.isPublished
          ? "公告已发布，可在平台更新页查看。"
          : "公告草稿已保存。";
      (onSaved ?? onSuccess)?.(message);
      onClose();
    } catch (submitError) {
      setError(normalizeAnnouncementError(submitError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={closeDialog}
      title={isEdit ? "编辑更新公告" : "发布更新公告"}
      description={
        isEdit
          ? "修改公告内容和发布状态，保存后会同步到管理员公告列表。"
          : "发布后的公告会展示在普通用户的平台更新页。"
      }
      footer={
        <>
          <Button onClick={() => void saveAnnouncement()} disabled={saving}>
            {saving ? (
              <Loader2 className="animate-spin" size={18} strokeWidth={3} />
            ) : (
              <Save size={18} strokeWidth={3} />
            )}
            {saving
              ? "提交中..."
              : isEdit
                ? "保存公告"
                : draft.isPublished
                  ? "发布公告"
                  : "保存草稿"}
          </Button>
          <Button variant="outline" onClick={closeDialog} disabled={saving}>
            取消
          </Button>
        </>
      }
    >
      {error ? <ErrorNotice message={error} /> : null}

      <DialogSection>
        <label className="text-sm font-black uppercase tracking-[0.14em]" htmlFor="announcement-title">
          公告标题
        </label>
        <Input
          id="announcement-title"
          value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          placeholder="例如：平台规则更新说明"
        />
      </DialogSection>

      <DialogSection>
        <label className="text-sm font-black uppercase tracking-[0.14em]" htmlFor="announcement-content">
          公告正文
        </label>
        <Textarea
          id="announcement-content"
          value={draft.content}
          onChange={(event) => setDraft({ ...draft, content: event.target.value })}
          placeholder="写清本次更新的影响范围、用户需要注意的事项"
          className="min-h-[11rem]"
        />
      </DialogSection>

      <DialogSection>
        <label className="text-sm font-black uppercase tracking-[0.14em]" htmlFor="announcement-category">
          公告分类
        </label>
        <Select
          id="announcement-category"
          value={draft.category}
          onChange={(event) =>
            setDraft({ ...draft, category: event.target.value as AnnouncementCategory })
          }
        >
          {categoryOptions.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </DialogSection>

      <DialogSection className="border-4 border-ink bg-secondary p-4 shadow-neo-sm">
        <label className="flex items-center gap-3 text-sm font-black uppercase tracking-[0.14em]">
          <input
            type="checkbox"
            className="h-5 w-5 accent-black"
            checked={draft.isPublished}
            onChange={(event) => setDraft({ ...draft, isPublished: event.target.checked })}
          />
          立即发布
        </label>
        <p className="text-sm font-bold leading-6">
          关闭后会保存为草稿，可稍后在公告管理页继续编辑或发布。
        </p>
      </DialogSection>

      <div className="border-4 border-ink bg-canvas p-4 shadow-neo-sm">
        <p className="flex items-center gap-2 text-sm font-black leading-6">
          <Megaphone size={16} strokeWidth={3} />
          公告不会从系统规则变更日志自动生成。
        </p>
      </div>
    </Dialog>
  );
}
