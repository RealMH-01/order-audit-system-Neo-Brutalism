"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  FilePlus2,
  History,
  Loader2,
  PenLine,
  Power,
  PowerOff,
  RefreshCcw,
  Save,
  ShieldAlert
} from "lucide-react";

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
  sortOrder: string;
  isEnabled: boolean;
  reason: string;
};

type ToggleDraft = {
  rule: SystemRuleAdminItem;
  nextEnabled: boolean;
  reason: string;
};

const emptyDraft: RuleDraft = {
  title: "",
  content: "",
  sortOrder: "",
  isEnabled: true,
  reason: ""
};

const ACTION_LABELS: Record<SystemRuleChangeLog["action"], string> = {
  create: "新增",
  update: "编辑",
  enable: "启用",
  disable: "停用",
  reorder: "排序",
  restore: "恢复"
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

function parseSortOrder(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: true as const, value: undefined };
  }

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed)) {
    return { ok: false as const, error: "sort_order 必须是整数，或留空交给后端处理。" };
  }

  return { ok: true as const, value: parsed };
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
    sortOrder: String(rule.sort_order),
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

  const [toggleDraft, setToggleDraft] = useState<ToggleDraft | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [toggleSaving, setToggleSaving] = useState(false);

  const isAdmin = authState.user?.role === "admin";

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
      setFormError("title 不能为空。");
      return;
    }
    if (!draft.content.trim()) {
      setFormError("content 不能为空。");
      return;
    }

    const reasonError = validateReason(draft.reason);
    if (reasonError) {
      setFormError(reasonError);
      return;
    }

    const sortOrder = parseSortOrder(draft.sortOrder);
    if (!sortOrder.ok) {
      setFormError(sortOrder.error);
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
          reason: draft.reason.trim(),
          ...(sortOrder.value === undefined ? {} : { sort_order: sortOrder.value })
        };
        await createAdminSystemRule(token, payload);
        setFeedback({ tone: "success", message: "系统规则已新增。" });
      } else if (editingRule) {
        const payload: UpdateSystemRulePayload = {
          title: draft.title.trim(),
          content: draft.content.trim(),
          reason: draft.reason.trim(),
          ...(sortOrder.value === undefined ? {} : { sort_order: sortOrder.value })
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
          <Button onClick={openCreateDialog}>
            <FilePlus2 size={18} strokeWidth={3} />
            新增系统规则
          </Button>
        }
      />

      {loadError ? <Notice tone="error" message={loadError} /> : null}
      {feedback ? <Notice tone={feedback.tone} message={feedback.message} /> : null}

      <div className="grid gap-6 xl:grid-cols-[1.18fr_0.82fr]">
        <section className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <SectionTitle
              title="规则列表"
              description="启用和停用规则都会显示，按 sort_order 从小到大排序。"
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
              {sortedRules.map((rule) => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  onEdit={() => openEditDialog(rule)}
                  onToggle={() => openToggleDialog(rule)}
                  onShowLogs={() => void selectLogRule(rule.id)}
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
          logs={logs}
          loading={logsLoading}
          selectedRule={selectedLogRule}
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
        rule={editingRule}
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
  onEdit,
  onToggle,
  onShowLogs
}: {
  rule: SystemRuleAdminItem;
  onEdit: () => void;
  onToggle: () => void;
  onShowLogs: () => void;
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
              <Badge variant="secondary">sort_order: {rule.sort_order}</Badge>
              <Badge variant="muted">{rule.code}</Badge>
            </div>
            <CardTitle>{rule.title}</CardTitle>
            <CardDescription>最近更新：{formatDate(rule.updated_at)}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
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
            <Button variant="outline" size="sm" onClick={onShowLogs}>
              <History size={16} strokeWidth={3} />
              日志
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
  rule,
  draft,
  saving,
  error,
  onClose,
  onChange,
  onSave
}: {
  open: boolean;
  mode: EditorMode;
  rule: SystemRuleAdminItem | null;
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
      description="所有写操作必须填写 reason。code 由后端生成或保留，前端不允许编辑。"
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

      {mode === "edit" && rule ? (
        <DialogSection>
          <label className="text-sm font-black uppercase tracking-[0.14em]" htmlFor="rule-code">
            code
          </label>
          <Input id="rule-code" value={rule.code} disabled />
        </DialogSection>
      ) : null}

      <DialogSection>
        <label className="text-sm font-black uppercase tracking-[0.14em]" htmlFor="rule-title">
          title
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
          content
        </label>
        <Textarea
          id="rule-content"
          value={draft.content}
          onChange={(event) => onChange({ ...draft, content: event.target.value })}
          placeholder="写清这条系统硬约束规则的审核要求"
          className="min-h-[10rem]"
        />
      </DialogSection>

      <div className="grid gap-4 md:grid-cols-2">
        <DialogSection>
          <label className="text-sm font-black uppercase tracking-[0.14em]" htmlFor="rule-sort-order">
            sort_order
          </label>
          <Input
            id="rule-sort-order"
            type="number"
            value={draft.sortOrder}
            onChange={(event) => onChange({ ...draft, sortOrder: event.target.value })}
            placeholder="留空则由后端处理"
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
      </div>

      <DialogSection>
        <label className="text-sm font-black uppercase tracking-[0.14em]" htmlFor="rule-reason">
          reason
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
            <p className="mt-2 break-words font-mono text-xs font-bold">{draft.rule.code}</p>
          </div>

          <DialogSection>
            <label className="text-sm font-black uppercase tracking-[0.14em]" htmlFor="toggle-reason">
              reason
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

function ChangeLogsPanel({
  logs,
  loading,
  selectedRule,
  onRefresh,
  onClearFilter
}: {
  logs: SystemRuleChangeLog[];
  loading: boolean;
  selectedRule: SystemRuleAdminItem | null;
  onRefresh: () => void;
  onClearFilter: () => void;
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <SectionTitle
          title="变更日志"
          description={
            selectedRule
              ? `当前只看：${selectedRule.title}`
              : "最近 50 条规则变更记录，old_value / new_value 折叠展示。"
          }
        />
        <div className="flex flex-wrap gap-2">
          {selectedRule ? (
            <Button variant="outline" size="sm" onClick={onClearFilter}>
              查看全部
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
            {loading ? (
              <Loader2 className="animate-spin" size={16} strokeWidth={3} />
            ) : (
              <RefreshCcw size={16} strokeWidth={3} />
            )}
            刷新日志
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
                <LogItem key={log.id} log={log} />
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

function LogItem({ log }: { log: SystemRuleChangeLog }) {
  return (
    <article className="border-4 border-ink bg-canvas p-4 shadow-neo-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{ACTION_LABELS[log.action]}</Badge>
        <Badge variant="muted">{log.rule_code_snapshot}</Badge>
      </div>
      <div className="space-y-2 text-sm font-bold leading-6">
        <p>{log.summary || "未记录摘要"}</p>
        <p>reason：{log.reason}</p>
        <p>changed_by：{log.changed_by}</p>
        <p>changed_at：{formatDate(log.changed_at)}</p>
      </div>
      <div className="mt-3 space-y-2">
        <JsonDetails title="old_value" value={log.old_value} />
        <JsonDetails title="new_value" value={log.new_value} />
      </div>
    </article>
  );
}

function JsonDetails({ title, value }: { title: string; value?: Record<string, unknown> | null }) {
  if (!value) {
    return null;
  }

  return (
    <details className="border-4 border-ink bg-paper p-3 shadow-neo-sm">
      <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.14em]">
        {title}
      </summary>
      <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs font-bold leading-5">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}
