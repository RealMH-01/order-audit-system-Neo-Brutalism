"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  FilePlus2,
  Loader2,
  Megaphone,
  PenLine,
  Power,
  PowerOff,
  RefreshCcw,
  Save,
  ShieldAlert
} from "lucide-react";

import { AnnouncementEditorDialog } from "@/components/admin/announcement-editor-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Dialog, DialogSection } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createAdminSystemRule,
  getAdminSystemRuleChangeLogs,
  getAdminSystemRules,
  updateAdminSystemRule,
  type CreateSystemRulePayload,
  type SystemRuleAdminItem,
  type SystemRuleChangeLog,
  type UpdateSystemRulePayload
} from "@/lib/api/admin-system-rules";
import { getStoredAccessToken } from "@/lib/api";
import { normalizeApiErrorDetail } from "@/lib/api-error";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

type Feedback = {
  tone: "success" | "error";
  message: string;
};

type EditorMode = "create" | "edit";

type RuleDraft = {
  title: string;
  content: string;
  isEnabled: boolean;
  reason: string;
};

type ToggleDraft = {
  rule: SystemRuleAdminItem;
  nextEnabled: boolean;
  reason: string;
};

type ReorderDraft = {
  rule: SystemRuleAdminItem;
  targetRule: SystemRuleAdminItem;
  direction: "up" | "down";
  reason: string;
};

const emptyDraft: RuleDraft = {
  title: "",
  content: "",
  isEnabled: true,
  reason: ""
};

function getErrorStatus(error: unknown) {
  if (typeof error === "object" && error && "status" in error) {
    const status = Number(error.status);
    return Number.isFinite(status) ? status : null;
  }
  return null;
}

function normalizeAdminError(error: unknown, fallback: string) {
  const status = getErrorStatus(error);
  if (status === 401) {
    return "登录状态已过期，请重新登录后继续。";
  }
  if (status === 403) {
    return "无权限访问系统规则管理。";
  }
  if (status === 400) {
    return normalizeApiErrorDetail(error, fallback);
  }
  return fallback;
}

function formatDate(value?: string | null) {
  if (!value) {
    return "未记录";
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

function validateReason(reason: string) {
  if (!reason.trim()) {
    return "reason 不能为空。";
  }
  if (reason.trim().length < 10) {
    return "reason 至少填写 10 个字符，方便后续追踪变更原因。";
  }
  return null;
}

function toDraft(rule: SystemRuleAdminItem): RuleDraft {
  return {
    title: rule.title,
    content: rule.content,
    isEnabled: rule.is_enabled,
    reason: ""
  };
}

export function SystemRulesAdminShell() {
  const { state: authState } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [rules, setRules] = useState<SystemRuleAdminItem[]>([]);
  const [logs, setLogs] = useState<SystemRuleChangeLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [logRuleId, setLogRuleId] = useState<string | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>("create");
  const [editingRule, setEditingRule] = useState<SystemRuleAdminItem | null>(null);
  const [draft, setDraft] = useState<RuleDraft>(emptyDraft);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [announcementEditorOpen, setAnnouncementEditorOpen] = useState(false);

  const [toggleDraft, setToggleDraft] = useState<ToggleDraft | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [toggleSaving, setToggleSaving] = useState(false);

  const [reorderDraft, setReorderDraft] = useState<ReorderDraft | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [reorderSaving, setReorderSaving] = useState(false);

  const isAdmin = authState.user?.role === "admin";
  const currentUserId = authState.user?.id ?? null;

  const sortedRules = useMemo(
    () => [...rules].sort((first, second) => first.sort_order - second.sort_order),
    [rules]
  );

  const selectedLogRule = useMemo(
    () => rules.find((rule) => rule.id === logRuleId) ?? null,
    [logRuleId, rules]
  );

  const loadLogs = useCallback(async (accessToken: string, selectedRuleId?: string | null) => {
    setLogsLoading(true);
    try {
      const nextLogs = await getAdminSystemRuleChangeLogs(accessToken, selectedRuleId);
      setLogs(nextLogs);
    } catch (error) {
      setFeedback({
        tone: "error",
        message: normalizeAdminError(error, "读取变更日志失败，请稍后重试。")
      });
    } finally {
      setLogsLoading(false);
    }
  }, []);

  const loadAll = useCallback(
    async (accessToken: string, selectedRuleId?: string | null) => {
      setLoading(true);
      setLoadError(null);
      setFeedback(null);

      try {
        const [nextRules, nextLogs] = await Promise.all([
          getAdminSystemRules(accessToken),
          getAdminSystemRuleChangeLogs(accessToken, selectedRuleId)
        ]);
        setRules(nextRules);
        setLogs(nextLogs);
      } catch (error) {
        setLoadError(normalizeAdminError(error, "读取系统规则管理资料失败，请稍后重试。"));
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

    void loadAll(accessToken, null);
  }, [isAdmin, loadAll]);

  const refreshAfterMutation = async (accessToken: string, selectedRuleId?: string | null) => {
    const [nextRules, nextLogs] = await Promise.all([
      getAdminSystemRules(accessToken),
      getAdminSystemRuleChangeLogs(accessToken, selectedRuleId)
    ]);
    setRules(nextRules);
    setLogs(nextLogs);
  };

  const openCreateDialog = () => {
    setEditorMode("create");
    setEditingRule(null);
    setDraft(emptyDraft);
    setFormError(null);
    setFeedback(null);
    setEditorOpen(true);
  };

  const openAnnouncementDialog = () => {
    setFeedback(null);
    setAnnouncementEditorOpen(true);
  };

  const openEditDialog = (rule: SystemRuleAdminItem) => {
    setEditorMode("edit");
    setEditingRule(rule);
    setDraft(toDraft(rule));
    setFormError(null);
    setFeedback(null);
    setEditorOpen(true);
  };

  const saveRule = async () => {
    if (!token) {
      setFormError("请先登录后再保存系统规则。");
      return;
    }

    if (!draft.title.trim()) {
      setFormError("标题不能为空。");
      return;
    }
    if (!draft.content.trim()) {
      setFormError("规则正文不能为空。");
      return;
    }

    const reasonError = validateReason(draft.reason);
    if (reasonError) {
      setFormError(reasonError);
      return;
    }

    setSaving(true);
    setFormError(null);
    setFeedback(null);

    try {
      if (editorMode === "create") {
        const payload: CreateSystemRulePayload = {
          title: draft.title.trim(),
          content: draft.content.trim(),
          is_enabled: draft.isEnabled,
          reason: draft.reason.trim()
        };
        await createAdminSystemRule(token, payload);
        setFeedback({ tone: "success", message: "系统规则已新增。" });
      } else if (editingRule) {
        const payload: UpdateSystemRulePayload = {
          title: draft.title.trim(),
          content: draft.content.trim(),
          reason: draft.reason.trim()
        };
        await updateAdminSystemRule(token, editingRule.id, payload);
        setFeedback({ tone: "success", message: "系统规则已保存。" });
      }

      await refreshAfterMutation(token, logRuleId);
      setEditorOpen(false);
    } catch (error) {
      setFormError(normalizeAdminError(error, "保存系统规则失败，请稍后重试。"));
    } finally {
      setSaving(false);
    }
  };

  const openToggleDialog = (rule: SystemRuleAdminItem) => {
    setToggleDraft({
      rule,
      nextEnabled: !rule.is_enabled,
      reason: ""
    });
    setToggleError(null);
    setFeedback(null);
  };

  const saveToggle = async () => {
    if (!token || !toggleDraft) {
      return;
    }

    const reasonError = validateReason(toggleDraft.reason);
    if (reasonError) {
      setToggleError(reasonError);
      return;
    }

    setToggleSaving(true);
    setToggleError(null);
    setFeedback(null);

    try {
      await updateAdminSystemRule(token, toggleDraft.rule.id, {
        is_enabled: toggleDraft.nextEnabled,
        reason: toggleDraft.reason.trim()
      });
      await refreshAfterMutation(token, logRuleId);
      setFeedback({
        tone: "success",
        message: toggleDraft.nextEnabled ? "系统规则已启用。" : "系统规则已停用。"
      });
      setToggleDraft(null);
    } catch (error) {
      setToggleError(normalizeAdminError(error, "操作失败，请稍后重试。"));
    } finally {
      setToggleSaving(false);
    }
  };

  const openReorderDialog = (rule: SystemRuleAdminItem, index: number, direction: "up" | "down") => {
    const targetRule = sortedRules[direction === "up" ? index - 1 : index + 1];
    if (!targetRule) {
      return;
    }

    setReorderDraft({
      rule,
      targetRule,
      direction,
      reason: ""
    });
    setReorderError(null);
    setFeedback(null);
  };

  const saveReorder = async () => {
    if (!token || !reorderDraft) {
      return;
    }

    const reasonError = validateReason(reorderDraft.reason);
    if (reasonError) {
      setReorderError(reasonError);
      return;
    }

    const sourceOrder = reorderDraft.rule.sort_order;
    const targetOrder = reorderDraft.targetRule.sort_order;
    const directionLabel = reorderDraft.direction === "up" ? "上一条" : "下一条";
    const reason = `${reorderDraft.reason.trim()}\n排序调整：与${directionLabel}交换位置。`;

    setReorderSaving(true);
    setReorderError(null);
    setFeedback(null);

    try {
      if (sourceOrder === targetOrder) {
        await updateAdminSystemRule(token, reorderDraft.rule.id, {
          sort_order: reorderDraft.direction === "up" ? sourceOrder - 1 : sourceOrder + 1,
          reason
        });
      } else {
        await updateAdminSystemRule(token, reorderDraft.rule.id, {
          sort_order: targetOrder,
          reason
        });
        await updateAdminSystemRule(token, reorderDraft.targetRule.id, {
          sort_order: sourceOrder,
          reason
        });
      }
      await refreshAfterMutation(token, logRuleId);
      setFeedback({ tone: "success", message: "规则排序已调整。" });
      setReorderDraft(null);
    } catch (error) {
      setReorderError(normalizeAdminError(error, "排序调整失败，请稍后重试。"));
      try {
        await refreshAfterMutation(token, logRuleId);
      } catch (refreshError) {
        setFeedback({
          tone: "error",
          message: normalizeAdminError(refreshError, "排序失败，且刷新最新数据失败，请手动刷新页面。")
        });
      }
    } finally {
      setReorderSaving(false);
    }
  };

  const selectLogRule = async (ruleId: string | null) => {
    setLogRuleId(ruleId);
    if (token) {
      await loadLogs(token, ruleId);
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
            <CardTitle>无权限访问系统规则管理</CardTitle>
            <CardDescription>
              当前账号不是管理员，不能查看新增、编辑、启用、停用或排序操作。真正权限以后端 403 为准。
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
              正在读取系统硬约束规则
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
            <Button variant="outline" onClick={openAnnouncementDialog}>
              <Megaphone size={18} strokeWidth={3} />
              发布更新公告
            </Button>
            <Button onClick={openCreateDialog}>
              <FilePlus2 size={18} strokeWidth={3} />
              新增系统规则
            </Button>
          </>
        }
      />

      {loadError ? <Notice tone="error" message={loadError} /> : null}
      {feedback ? <Notice tone={feedback.tone} message={feedback.message} /> : null}

      <div className="grid gap-6 xl:grid-cols-[1.18fr_0.82fr]">
        <section className="space-y-4 xl:max-h-[calc(100vh-260px)] xl:overflow-y-auto xl:pr-2">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <SectionTitle
              title="规则列表"
              description="启用和停用规则都会显示，可以用上移 / 下移调整展示顺序。"
            />
            <Button
              variant="outline"
              onClick={() => {
                if (token) {
                  void loadAll(token, logRuleId);
                }
              }}
            >
              <RefreshCcw size={18} strokeWidth={3} />
              刷新
            </Button>
          </div>

          {sortedRules.length > 0 ? (
            <div className="space-y-4">
              {sortedRules.map((rule, index) => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  isFirst={index === 0}
                  isLast={index === sortedRules.length - 1}
                  onEdit={() => openEditDialog(rule)}
                  onToggle={() => openToggleDialog(rule)}
                  onShowLogs={() => void selectLogRule(rule.id)}
                  onMoveUp={() => openReorderDialog(rule, index, "up")}
                  onMoveDown={() => openReorderDialog(rule, index, "down")}
                />
              ))}
            </div>
          ) : (
            <Card className="bg-muted">
              <CardHeader>
                <CardTitle>暂无系统规则</CardTitle>
                <CardDescription>
                  可以新增一条系统规则。后端仍会校验至少保留一条启用规则。
                </CardDescription>
              </CardHeader>
            </Card>
          )}
        </section>

        <ChangeLogsPanel
          rules={rules}
          logs={logs}
          loading={logsLoading}
          selectedRule={selectedLogRule}
          currentUserId={currentUserId}
          onRefresh={() => {
            if (token) {
              void loadLogs(token, logRuleId);
            }
          }}
          onClearFilter={() => void selectLogRule(null)}
        />
      </div>

      <RuleEditorDialog
        open={editorOpen}
        mode={editorMode}
        draft={draft}
        saving={saving}
        error={formError}
        onClose={() => {
          if (!saving) {
            setEditorOpen(false);
          }
        }}
        onChange={setDraft}
        onSave={() => void saveRule()}
      />

      <AnnouncementEditorDialog
        open={announcementEditorOpen}
        token={token}
        onClose={() => setAnnouncementEditorOpen(false)}
        onSuccess={(message) => {
          setFeedback({ tone: "success", message });
          setAnnouncementEditorOpen(false);
        }}
      />

      <ToggleRuleDialog
        draft={toggleDraft}
        error={toggleError}
        saving={toggleSaving}
        onChange={(reason) => {
          setToggleDraft((current) => (current ? { ...current, reason } : current));
        }}
        onClose={() => {
          if (!toggleSaving) {
            setToggleDraft(null);
          }
        }}
        onSave={() => void saveToggle()}
      />

      <ReorderRuleDialog
        draft={reorderDraft}
        error={reorderError}
        saving={reorderSaving}
        onChange={(reason) => {
          setReorderDraft((current) => (current ? { ...current, reason } : current));
        }}
        onClose={() => {
          if (!reorderSaving) {
            setReorderDraft(null);
          }
        }}
        onSave={() => void saveReorder()}
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
              系统硬约束规则管理
            </h1>
            <p className="max-w-4xl text-base font-bold leading-7 md:text-lg">
              这些规则会影响所有用户的新审核。修改后只影响新审核，历史审核快照不受影响。
            </p>
          </div>
        </div>
        {action ? <div className="flex flex-wrap gap-3">{action}</div> : null}
      </div>
    </header>
  );
}

function SectionTitle({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-2">
      <h2 className="text-3xl font-black uppercase leading-none tracking-tight">{title}</h2>
      <p className="max-w-3xl text-sm font-bold leading-6 md:text-base">{description}</p>
    </div>
  );
}

function Notice({ tone, message }: Feedback) {
  return (
    <div className={cn(tone === "success" ? "issue-blue" : "issue-red", "p-4")}>
      <p className="text-sm font-black leading-6">{message}</p>
    </div>
  );
}

function RuleCard({
  rule,
  isFirst,
  isLast,
  onEdit,
  onToggle,
  onShowLogs,
  onMoveUp,
  onMoveDown
}: {
  rule: SystemRuleAdminItem;
  isFirst: boolean;
  isLast: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onShowLogs: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return (
    <Card className={cn(rule.is_enabled ? "bg-paper" : "bg-muted opacity-80")}>
      <CardHeader>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={rule.is_enabled ? "inverse" : "neutral"}>
                {rule.is_enabled ? "启用" : "停用"}
              </Badge>
            </div>
            <CardTitle>{rule.title}</CardTitle>
            <CardDescription>
              最近更新：{formatDate(rule.updated_at)}
              <button
                type="button"
                className="ml-3 font-black underline decoration-4 underline-offset-4 hover:opacity-70"
                onClick={onShowLogs}
              >
                查看变更
              </button>
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={onMoveUp} disabled={isFirst}>
              <ArrowUp size={16} strokeWidth={3} />
              上移
            </Button>
            <Button variant="outline" size="sm" onClick={onMoveDown} disabled={isLast}>
              <ArrowDown size={16} strokeWidth={3} />
              下移
            </Button>
            <Button variant="outline" size="sm" onClick={onEdit}>
              <PenLine size={16} strokeWidth={3} />
              编辑
            </Button>
            <Button variant={rule.is_enabled ? "secondary" : "primary"} size="sm" onClick={onToggle}>
              {rule.is_enabled ? (
                <PowerOff size={16} strokeWidth={3} />
              ) : (
                <Power size={16} strokeWidth={3} />
              )}
              {rule.is_enabled ? "停用" : "启用"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="border-4 border-ink bg-canvas p-4 shadow-neo-sm">
          <p className="whitespace-pre-wrap break-words text-sm font-bold leading-6">{rule.content}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function RuleEditorDialog({
  open,
  mode,
  draft,
  saving,
  error,
  onClose,
  onChange,
  onSave
}: {
  open: boolean;
  mode: EditorMode;
  draft: RuleDraft;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onChange: (draft: RuleDraft) => void;
  onSave: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === "create" ? "新增系统规则" : "编辑系统规则"}
      description="所有写操作都必须填写变更原因，方便后续追踪。"
      footer={
        <>
          <Button onClick={onSave} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" size={18} strokeWidth={3} /> : <Save size={18} strokeWidth={3} />}
            {saving ? "保存中..." : "确认保存"}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            取消
          </Button>
        </>
      }
    >
      {error ? <Notice tone="error" message={error} /> : null}

      <DialogSection>
        <label className="text-sm font-black uppercase tracking-[0.14em]" htmlFor="rule-title">
          标题
        </label>
        <Input
          id="rule-title"
          value={draft.title}
          onChange={(event) => onChange({ ...draft, title: event.target.value })}
          placeholder="例如：金额与币种必须一致"
        />
      </DialogSection>

      <DialogSection>
        <label className="text-sm font-black uppercase tracking-[0.14em]" htmlFor="rule-content">
          规则正文
        </label>
        <Textarea
          id="rule-content"
          value={draft.content}
          onChange={(event) => onChange({ ...draft, content: event.target.value })}
          placeholder="写清这条系统硬约束规则的审核要求"
          className="min-h-[10rem]"
        />
      </DialogSection>

      {mode === "create" ? (
        <DialogSection className="border-4 border-ink bg-secondary p-4 shadow-neo-sm">
          <label className="flex items-center gap-3 text-sm font-black uppercase tracking-[0.14em]">
            <input
              type="checkbox"
              className="h-5 w-5 accent-black"
              checked={draft.isEnabled}
              onChange={(event) => onChange({ ...draft, isEnabled: event.target.checked })}
            />
            创建后立即启用
          </label>
        </DialogSection>
      ) : null}

      <DialogSection>
        <label className="text-sm font-black uppercase tracking-[0.14em]" htmlFor="rule-reason">
          变更原因
        </label>
        <Textarea
          id="rule-reason"
          value={draft.reason}
          onChange={(event) => onChange({ ...draft, reason: event.target.value })}
          placeholder="说明为什么要新增或修改这条系统规则，至少 10 个字符"
          className="min-h-[7rem]"
        />
      </DialogSection>
    </Dialog>
  );
}

function ToggleRuleDialog({
  draft,
  error,
  saving,
  onChange,
  onClose,
  onSave
}: {
  draft: ToggleDraft | null;
  error: string | null;
  saving: boolean;
  onChange: (reason: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const disabling = draft ? !draft.nextEnabled : false;

  return (
    <Dialog
      open={Boolean(draft)}
      onClose={onClose}
      title={disabling ? "停用系统规则" : "启用系统规则"}
      description="启用或停用也会影响新审核，必须填写 reason 后才能确认。"
      footer={
        <>
          <Button onClick={onSave} disabled={saving}>
            {saving ? (
              <Loader2 className="animate-spin" size={18} strokeWidth={3} />
            ) : disabling ? (
              <PowerOff size={18} strokeWidth={3} />
            ) : (
              <Power size={18} strokeWidth={3} />
            )}
            {saving ? "提交中..." : disabling ? "确认停用" : "确认启用"}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            取消
          </Button>
        </>
      }
    >
      {draft ? (
        <>
          {error ? <Notice tone="error" message={error} /> : null}

          <div className="border-4 border-ink bg-secondary p-4 shadow-neo-sm">
            <p className="text-sm font-black leading-6">
              {disabling
                ? "停用后，所有新审核将不再使用这条系统规则。历史审核不受影响。"
                : "启用后，所有新审核都会重新使用这条系统规则。历史审核不受影响。"}
            </p>
          </div>

          <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
            <p className="text-sm font-black leading-6">{draft.rule.title}</p>
          </div>

          <DialogSection>
            <label className="text-sm font-black uppercase tracking-[0.14em]" htmlFor="toggle-reason">
              变更原因
            </label>
            <Textarea
              id="toggle-reason"
              value={draft.reason}
              onChange={(event) => onChange(event.target.value)}
              placeholder="说明为什么要启用或停用这条系统规则，至少 10 个字符"
              className="min-h-[7rem]"
            />
          </DialogSection>
        </>
      ) : null}
    </Dialog>
  );
}

function ReorderRuleDialog({
  draft,
  error,
  saving,
  onChange,
  onClose,
  onSave
}: {
  draft: ReorderDraft | null;
  error: string | null;
  saving: boolean;
  onChange: (reason: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const directionLabel = draft?.direction === "up" ? "上移" : "下移";

  return (
    <Dialog
      open={Boolean(draft)}
      onClose={onClose}
      title={`确认${directionLabel}规则`}
      description="排序调整也会记录到变更日志，必须填写变更原因后才能确认。"
      footer={
        <>
          <Button onClick={onSave} disabled={saving}>
            {saving ? (
              <Loader2 className="animate-spin" size={18} strokeWidth={3} />
            ) : draft?.direction === "up" ? (
              <ArrowUp size={18} strokeWidth={3} />
            ) : (
              <ArrowDown size={18} strokeWidth={3} />
            )}
            {saving ? "提交中..." : `确认${directionLabel}`}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            取消
          </Button>
        </>
      }
    >
      {draft ? (
        <>
          {error ? <Notice tone="error" message={error} /> : null}

          <div className="space-y-3 border-4 border-ink bg-paper p-4 shadow-neo-sm">
            <p className="text-sm font-black leading-6">
              将《{draft.rule.title}》与《{draft.targetRule.title}》交换位置。
            </p>
          </div>

          <DialogSection>
            <label className="text-sm font-black uppercase tracking-[0.14em]" htmlFor="reorder-reason">
              变更原因
            </label>
            <Textarea
              id="reorder-reason"
              value={draft.reason}
              onChange={(event) => onChange(event.target.value)}
              placeholder="说明为什么要调整这条系统规则的顺序，至少 10 个字符"
              className="min-h-[7rem]"
            />
          </DialogSection>
        </>
      ) : null}
    </Dialog>
  );
}

function ChangeLogsPanel({
  rules,
  logs,
  loading,
  selectedRule,
  currentUserId,
  onRefresh,
  onClearFilter
}: {
  rules: SystemRuleAdminItem[];
  logs: SystemRuleChangeLog[];
  loading: boolean;
  selectedRule: SystemRuleAdminItem | null;
  currentUserId: string | null;
  onRefresh: () => void;
  onClearFilter: () => void;
}) {
  return (
    <section className="space-y-4 xl:max-h-[calc(100vh-260px)] xl:overflow-y-auto xl:pr-2">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <SectionTitle
          title="变更日志"
          description={
            selectedRule
              ? `当前只看：${selectedRule.title}`
              : "最近 50 条规则变更记录。"
          }
        />
        <div className="flex flex-wrap gap-2">
          {selectedRule ? (
            <Button variant="outline" size="sm" onClick={onClearFilter}>
              查看全部
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
            aria-label="刷新日志"
            title="刷新日志"
            className="min-w-[2.75rem] px-3"
          >
            {loading ? (
              <Loader2 className="animate-spin" size={16} strokeWidth={3} />
            ) : (
              <RefreshCcw size={16} strokeWidth={3} />
            )}
          </Button>
        </div>
      </div>

      <Card className="bg-paper">
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-3 py-8">
              <Loader2 className="animate-spin" size={18} strokeWidth={3} />
              <p className="text-sm font-black uppercase tracking-[0.14em]">正在读取日志</p>
            </div>
          ) : logs.length > 0 ? (
            <div className="space-y-4">
              {logs.map((log) => (
                <LogItem key={log.id} log={log} rules={rules} currentUserId={currentUserId} />
              ))}
            </div>
          ) : (
            <p className="text-sm font-black leading-6">暂无变更日志。</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

const ACTION_VERBS: Record<SystemRuleChangeLog["action"], string> = {
  create: "新增了",
  update: "编辑了",
  enable: "启用了",
  disable: "停用了",
  reorder: "调整了排序",
  restore: "恢复了"
};

function readSnapshotTitle(value?: Record<string, unknown> | null) {
  const title = value?.title;
  return typeof title === "string" && title.trim() ? title.trim() : null;
}

function getLogActor(log: SystemRuleChangeLog, currentUserId: string | null) {
  if (currentUserId && log.changed_by === currentUserId) {
    return "你";
  }
  if (log.changed_by_email?.trim()) {
    return log.changed_by_email.trim();
  }
  return "其他管理员";
}

function getLogRuleTitle(log: SystemRuleChangeLog, rules: SystemRuleAdminItem[]) {
  const currentRuleTitle = rules.find((rule) => rule.id === log.rule_id)?.title;
  if (currentRuleTitle) {
    return currentRuleTitle;
  }

  return (
    readSnapshotTitle(log.new_value) ||
    readSnapshotTitle(log.old_value) ||
    log.summary ||
    "未知规则"
  );
}

function LogItem({
  log,
  rules,
  currentUserId
}: {
  log: SystemRuleChangeLog;
  rules: SystemRuleAdminItem[];
  currentUserId: string | null;
}) {
  const actor = getLogActor(log, currentUserId);
  const ruleTitle = getLogRuleTitle(log, rules);

  return (
    <article className="border-4 border-ink bg-canvas p-4 shadow-neo-sm">
      <div className="space-y-2 text-sm font-bold leading-6">
        <p className="font-black">
          {formatDate(log.changed_at)} · {actor} {ACTION_VERBS[log.action]}规则《{ruleTitle}》
        </p>
        <p>原因：{log.reason}</p>
      </div>

      <details className="mt-3 border-4 border-ink bg-paper p-3 shadow-neo-sm">
        <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.14em]">
          查看技术详情
        </summary>
        <div className="mt-3 space-y-3 text-xs font-bold leading-5">
          <p className="break-words">
            <span className="font-black">rule_code_snapshot：</span>
            <span className="font-mono">{log.rule_code_snapshot}</span>
          </p>
          <p className="break-words">
            <span className="font-black">changed_by：</span>
            <span className="font-mono">{log.changed_by}</span>
          </p>
          <JsonBlock title="old_value" value={log.old_value} />
          <JsonBlock title="new_value" value={log.new_value} />
        </div>
      </details>
    </article>
  );
}

function JsonBlock({ title, value }: { title: string; value?: Record<string, unknown> | null }) {
  if (!value) {
    return null;
  }

  return (
    <div className="space-y-2">
      <p className="font-black">{title}</p>
      <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs font-bold leading-5">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
