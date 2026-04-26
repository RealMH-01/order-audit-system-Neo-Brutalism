"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpenCheck,
  Copy,
  FilePlus2,
  Loader2,
  PenLine,
  RefreshCcw,
  ShieldCheck,
  Star,
  Trash2
} from "lucide-react";

import type {
  AuditRulePackage,
  AuditRulePackageListResponse,
  AuditTemplate,
  AuditTemplateDraft,
  AuditTemplateListResponse,
  MessageResponse,
  SystemHardRulesResponse
} from "@/components/templates/types";
import {
  createTemplateDraft,
  formatTemplateDate,
  normalizeTemplateError,
  resolveBusinessTypeLabel,
  resolvePackageTone,
  sortTemplates,
  summarizeSupplementalRules,
  toTemplateDraft
} from "@/components/templates/template-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogSection } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  getStoredAccessToken
} from "@/lib/api";
import { cn } from "@/lib/utils";

type EditorMode = "create" | "edit";

type Feedback = {
  tone: "success" | "error";
  message: string;
};

const SUPPLEMENTAL_PLACEHOLDER = [
  "某客户发票抬头必须完全一致",
  "欧洲客户必须检查 VAT No.",
  "宁波客户包装单位必须写 CTN",
  "某供应商付款方式必须月结 30 天"
].join("\n");

export function TemplateLibraryShell() {
  const [token, setToken] = useState<string | null>(null);
  const [systemRules, setSystemRules] = useState<SystemHardRulesResponse | null>(null);
  const [rulePackages, setRulePackages] = useState<AuditRulePackage[]>([]);
  const [templates, setTemplates] = useState<AuditTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>("create");
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AuditTemplateDraft>(createTemplateDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [openingTemplateId, setOpeningTemplateId] = useState<string | null>(null);
  const [duplicatingTemplateId, setDuplicatingTemplateId] = useState<string | null>(null);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);
  const [defaultingTemplateId, setDefaultingTemplateId] = useState<string | null>(null);

  const loadTemplates = useCallback(async (accessToken: string) => {
    const { data } = await apiGet<AuditTemplateListResponse>("/templates", {
      token: accessToken
    });
    setTemplates(sortTemplates(data.templates));
  }, []);

  const loadAll = useCallback(
    async (accessToken: string) => {
      setLoading(true);
      setLoadError(null);

      try {
        const [systemResult, packageResult, templateResult] = await Promise.all([
          apiGet<SystemHardRulesResponse>("/templates/system-rules", { token: accessToken }),
          apiGet<AuditRulePackageListResponse>("/templates/rule-packages", {
            token: accessToken
          }),
          apiGet<AuditTemplateListResponse>("/templates", { token: accessToken })
        ]);

        setSystemRules(systemResult.data);
        setRulePackages(packageResult.data.packages);
        setTemplates(sortTemplates(templateResult.data.templates));
      } catch (error) {
        setLoadError(normalizeTemplateError(error, "模板资料读取失败，请稍后重试。"));
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    const accessToken = getStoredAccessToken();
    setToken(accessToken);

    if (!accessToken) {
      setLoading(false);
      setLoadError("请先登录后再管理单据审核模板。");
      return;
    }

    void loadAll(accessToken);
  }, [loadAll]);

  const groupedPackages = useMemo(
    () => ({
      base: rulePackages.filter((item) => item.package_type === "base_common"),
      domestic: rulePackages.filter((item) => item.business_type === "domestic"),
      foreign: rulePackages.filter((item) => item.business_type === "foreign")
    }),
    [rulePackages]
  );

  const openCreateDialog = () => {
    setEditorMode("create");
    setEditingTemplateId(null);
    setDraft(createTemplateDraft());
    setFormError(null);
    setFeedback(null);
    setDialogOpen(true);
  };

  const openEditDialog = async (template: AuditTemplate) => {
    if (!token) {
      setFeedback({ tone: "error", message: "请先登录后再编辑模板。" });
      return;
    }

    setOpeningTemplateId(template.id);
    setFeedback(null);
    setFormError(null);

    try {
      const { data } = await apiGet<AuditTemplate>(`/templates/${template.id}`, {
        token
      });
      setEditorMode("edit");
      setEditingTemplateId(data.id);
      setDraft(toTemplateDraft(data));
      setDialogOpen(true);
    } catch (error) {
      setFeedback({
        tone: "error",
        message: normalizeTemplateError(error, "模板详情读取失败，请稍后重试。")
      });
    } finally {
      setOpeningTemplateId(null);
    }
  };

  const saveTemplate = async () => {
    if (!token) {
      setFormError("请先登录后再保存模板。");
      return;
    }

    if (!draft.name.trim()) {
      setFormError("模板名称不能为空。");
      return;
    }

    setSaving(true);
    setFormError(null);
    setFeedback(null);

    const payload = {
      name: draft.name.trim(),
      description: draft.description.trim(),
      business_type: draft.business_type,
      supplemental_rules: draft.supplemental_rules.trim()
    };

    try {
      if (editorMode === "create") {
        await apiPost<AuditTemplate>("/templates", payload, { token });
        setFeedback({ tone: "success", message: "模板已创建。" });
      } else if (editingTemplateId) {
        await apiPatch<AuditTemplate>(`/templates/${editingTemplateId}`, payload, {
          token
        });
        setFeedback({ tone: "success", message: "模板修改已保存。" });
      }

      await loadTemplates(token);
      setDialogOpen(false);
    } catch (error) {
      setFormError(normalizeTemplateError(error, "保存模板失败，请稍后重试。"));
    } finally {
      setSaving(false);
    }
  };

  const duplicateTemplate = async (template: AuditTemplate) => {
    if (!token) {
      setFeedback({ tone: "error", message: "请先登录后再复制模板。" });
      return;
    }

    setDuplicatingTemplateId(template.id);
    setFeedback(null);

    try {
      await apiPost<AuditTemplate>(`/templates/${template.id}/duplicate`, undefined, {
        token
      });
      await loadTemplates(token);
      setFeedback({ tone: "success", message: "模板已复制。" });
    } catch (error) {
      setFeedback({
        tone: "error",
        message: normalizeTemplateError(error, "复制模板失败，请稍后重试。")
      });
    } finally {
      setDuplicatingTemplateId(null);
    }
  };

  const deleteTemplate = async (template: AuditTemplate) => {
    if (!token) {
      setFeedback({ tone: "error", message: "请先登录后再删除模板。" });
      return;
    }

    const confirmed =
      typeof window === "undefined" ||
      window.confirm(`确认删除模板“${template.name}”吗？删除后无法恢复。`);

    if (!confirmed) {
      return;
    }

    setDeletingTemplateId(template.id);
    setFeedback(null);

    try {
      const { data } = await apiDelete<MessageResponse>(`/templates/${template.id}`, {
        token
      });
      setTemplates((current) => current.filter((item) => item.id !== template.id));
      setFeedback({ tone: "success", message: data.message || "模板已删除。" });
    } catch (error) {
      setFeedback({
        tone: "error",
        message: normalizeTemplateError(error, "删除模板失败，请稍后重试。")
      });
    } finally {
      setDeletingTemplateId(null);
    }
  };

  const setDefaultTemplate = async (template: AuditTemplate) => {
    if (!token) {
      setFeedback({ tone: "error", message: "请先登录后再设置默认模板。" });
      return;
    }

    setDefaultingTemplateId(template.id);
    setFeedback(null);

    try {
      const { data } = await apiPost<AuditTemplate>(
        `/templates/${template.id}/set-default`,
        undefined,
        { token }
      );
      setTemplates((current) =>
        sortTemplates(
          current.map((item) => ({
            ...item,
            is_default: item.id === data.id,
            updated_at: item.id === data.id ? data.updated_at : item.updated_at
          }))
        )
      );
      setFeedback({ tone: "success", message: "默认模板已更新。" });
    } catch (error) {
      setFeedback({
        tone: "error",
        message: normalizeTemplateError(error, "设置默认模板失败，请稍后重试。")
      });
    } finally {
      setDefaultingTemplateId(null);
    }
  };

  if (loading) {
    return (
      <section className="space-y-6">
        <Card className="bg-secondary">
          <CardContent className="flex items-center gap-3 py-10">
            <Loader2 className="animate-spin" size={22} strokeWidth={3} />
            <p className="text-sm font-black uppercase tracking-[0.14em]">
              正在读取模板资料
            </p>
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section className="space-y-8">
      <header className="border-4 border-ink bg-paper p-6 shadow-neo-lg md:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-4">
            <Badge variant="secondary" className="-rotate-1">
              模板库
            </Badge>
            <div className="space-y-3">
              <h1 className="max-w-4xl text-4xl font-black uppercase leading-none tracking-tight md:text-6xl">
                单据审核模板
              </h1>
              <p className="max-w-3xl text-base font-bold leading-7 md:text-lg">
                管理不同业务场景下的审核模板，后续审核时可选择本轮使用的模板。
              </p>
            </div>
          </div>
          <Button onClick={openCreateDialog} className="w-fit">
            <FilePlus2 size={18} strokeWidth={3} />
            新建模板
          </Button>
        </div>
        <div className="mt-6 border-4 border-ink bg-acid p-4 shadow-neo-sm">
          <p className="text-sm font-black leading-6 md:text-base">
            系统硬规则 + 基础通用规则 + 内贸/外贸规则包 + 我的补充规则 = 本轮审核规则
          </p>
        </div>
      </header>

      {loadError ? (
        <Notice tone="error" message={loadError} />
      ) : null}

      {feedback ? <Notice tone={feedback.tone} message={feedback.message} /> : null}

      <SystemHardRulesPanel systemRules={systemRules} />

      <section className="space-y-4">
        <SectionTitle
          title="规则包"
          description="基础规则和业务规则只读展示，实际审核时按模板业务类型匹配内贸或外贸规则包。"
        />
        <div className="grid gap-5 lg:grid-cols-3">
          <PackageGroup title="基础通用规则包" packages={groupedPackages.base} />
          <PackageGroup title="内贸规则包" packages={groupedPackages.domestic} />
          <PackageGroup title="外贸规则包" packages={groupedPackages.foreign} />
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <SectionTitle
            title="我的模板"
            description="为客户、行业、公司或单据类型补充专属审核要求。"
          />
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              onClick={() => {
                if (token) {
                  void loadTemplates(token);
                }
              }}
            >
              <RefreshCcw size={18} strokeWidth={3} />
              刷新模板
            </Button>
            <Button onClick={openCreateDialog}>
              <FilePlus2 size={18} strokeWidth={3} />
              新建模板
            </Button>
          </div>
        </div>

        {templates.length === 0 ? (
          <Card className="bg-muted">
            <CardContent className="py-8">
              <p className="text-base font-black leading-7">
                还没有自定义模板，可以先创建一个通用单据审核模板。
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            {templates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                opening={openingTemplateId === template.id}
                duplicating={duplicatingTemplateId === template.id}
                deleting={deletingTemplateId === template.id}
                defaulting={defaultingTemplateId === template.id}
                onEdit={() => void openEditDialog(template)}
                onDuplicate={() => void duplicateTemplate(template)}
                onDelete={() => void deleteTemplate(template)}
                onSetDefault={() => void setDefaultTemplate(template)}
              />
            ))}
          </div>
        )}
      </section>

      <TemplateEditorDialog
        open={dialogOpen}
        mode={editorMode}
        draft={draft}
        saving={saving}
        error={formError}
        onClose={() => {
          if (!saving) {
            setDialogOpen(false);
          }
        }}
        onChange={setDraft}
        onSave={() => void saveTemplate()}
      />
    </section>
  );
}

function Notice({ tone, message }: Feedback) {
  return (
    <div className={cn(tone === "success" ? "issue-blue" : "issue-red", "p-4")}>
      <p className="text-sm font-bold leading-6">{message}</p>
    </div>
  );
}

function SectionTitle({
  title,
  description
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-2">
      <h2 className="text-3xl font-black uppercase leading-none tracking-tight">
        {title}
      </h2>
      <p className="max-w-3xl text-sm font-bold leading-6 md:text-base">
        {description}
      </p>
    </div>
  );
}

function SystemHardRulesPanel({
  systemRules
}: {
  systemRules: SystemHardRulesResponse | null;
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <SectionTitle
          title="系统硬规则"
          description="固定启用，不可关闭。所有审核都会遵守这些底线要求。"
        />
        <Badge variant="inverse">
          <ShieldCheck size={14} strokeWidth={3} />
          固定启用，不可关闭
        </Badge>
      </div>

      <Card className="bg-paper">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="accent">第 {systemRules?.version ?? 1} 版</Badge>
            <CardTitle>{systemRules?.title ?? "系统硬规则"}</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2">
            {(systemRules?.rules ?? []).map((rule, index) => (
              <div
                key={rule.code}
                className="border-4 border-ink bg-secondary p-4 shadow-neo-sm"
              >
                <div className="mb-2 flex items-center gap-3">
                  <span className="inline-flex h-9 w-9 items-center justify-center border-4 border-ink bg-paper text-sm font-black shadow-neo-sm">
                    {index + 1}
                  </span>
                  <h3 className="text-lg font-black leading-tight">{rule.title}</h3>
                </div>
                <p className="text-sm font-bold leading-6">{rule.content}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function PackageGroup({
  title,
  packages
}: {
  title: string;
  packages: AuditRulePackage[];
}) {
  if (packages.length === 0) {
    return (
      <Card className="bg-paper">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm font-bold leading-6">当前没有可展示的规则包。</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {packages.map((packageItem) => (
        <Card
          key={packageItem.id}
          className={cn(resolvePackageTone(packageItem), "h-full")}
        >
          <CardHeader>
            <div className="flex flex-wrap gap-2">
              <Badge variant="inverse">第 {packageItem.version} 版</Badge>
              <Badge variant="neutral">
                适用场景：{resolveBusinessTypeLabel(packageItem.business_type)}
              </Badge>
            </div>
            <CardTitle>{packageItem.name || title}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-bold leading-6">
              {packageItem.description || "这组规则会参与对应业务场景的审核。"}
            </p>
            <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
              <p className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-[0.14em]">
                <BookOpenCheck size={16} strokeWidth={3} />
                规则列表
              </p>
              <ul className="space-y-2">
                {packageItem.rules.map((rule) => (
                  <li key={rule} className="text-sm font-bold leading-6">
                    {rule}
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function TemplateCard({
  template,
  opening,
  duplicating,
  deleting,
  defaulting,
  onEdit,
  onDuplicate,
  onDelete,
  onSetDefault
}: {
  template: AuditTemplate;
  opening: boolean;
  duplicating: boolean;
  deleting: boolean;
  defaulting: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
}) {
  return (
    <Card className={template.is_default ? "bg-acid" : "bg-paper"}>
      <CardHeader>
        <div className="flex flex-wrap gap-2">
          <Badge variant={template.business_type === "domestic" ? "muted" : "secondary"}>
            {resolveBusinessTypeLabel(template.business_type)}
          </Badge>
          {template.is_default ? (
            <Badge variant="inverse">
              <Star size={14} strokeWidth={3} />
              默认模板
            </Badge>
          ) : null}
        </div>
        <CardTitle>{template.name}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="min-h-[3rem] text-sm font-bold leading-6">
          {template.description || "暂无模板说明。"}
        </p>
        <div className="border-4 border-ink bg-secondary p-4 shadow-neo-sm">
          <p className="text-xs font-black uppercase tracking-[0.14em]">我的补充规则</p>
          <p className="mt-2 text-sm font-bold leading-6">
            {summarizeSupplementalRules(template.supplemental_rules)}
          </p>
        </div>
        <div className="grid gap-3 text-sm font-bold leading-6 md:grid-cols-2">
          <div className="border-4 border-ink bg-paper p-3 shadow-neo-sm">
            创建：{formatTemplateDate(template.created_at)}
          </div>
          <div className="border-4 border-ink bg-paper p-3 shadow-neo-sm">
            更新：{formatTemplateDate(template.updated_at)}
          </div>
        </div>
      </CardContent>
      <CardFooter>
        <Button variant="outline" onClick={onEdit} disabled={opening}>
          <PenLine size={18} strokeWidth={3} />
          {opening ? "打开中..." : "编辑"}
        </Button>
        <Button variant="secondary" onClick={onDuplicate} disabled={duplicating}>
          <Copy size={18} strokeWidth={3} />
          {duplicating ? "复制中..." : "复制"}
        </Button>
        <Button
          variant="muted"
          onClick={onSetDefault}
          disabled={template.is_default || defaulting}
        >
          <Star size={18} strokeWidth={3} />
          {defaulting ? "设置中..." : "设为默认"}
        </Button>
        <Button variant="outline" onClick={onDelete} disabled={deleting}>
          <Trash2 size={18} strokeWidth={3} />
          {deleting ? "删除中..." : "删除"}
        </Button>
      </CardFooter>
    </Card>
  );
}

function TemplateEditorDialog({
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
  draft: AuditTemplateDraft;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onChange: (nextDraft: AuditTemplateDraft) => void;
  onSave: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === "create" ? "新建模板" : "编辑模板"}
      description="填写该客户、行业、公司或单据类型的专属审核要求。"
      footer={
        <>
          <Button onClick={onSave} disabled={saving}>
            <ShieldCheck size={18} strokeWidth={3} />
            {saving ? "保存中..." : "保存模板"}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            取消
          </Button>
        </>
      }
    >
      {error ? <Notice tone="error" message={error} /> : null}

      <DialogSection>
        <label className="text-sm font-black uppercase tracking-[0.14em]" htmlFor="template-name">
          模板名称
        </label>
        <Input
          id="template-name"
          value={draft.name}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
          placeholder="通用单据审核模板"
        />
      </DialogSection>

      <DialogSection>
        <label
          className="text-sm font-black uppercase tracking-[0.14em]"
          htmlFor="template-description"
        >
          模板说明
        </label>
        <Input
          id="template-description"
          value={draft.description}
          onChange={(event) => onChange({ ...draft, description: event.target.value })}
          placeholder="说明这套模板适合哪些客户、行业或单据类型"
        />
      </DialogSection>

      <DialogSection>
        <label
          className="text-sm font-black uppercase tracking-[0.14em]"
          htmlFor="template-business-type"
        >
          这套模板主要用于内贸还是外贸？
        </label>
        <Select
          id="template-business-type"
          value={draft.business_type}
          onChange={(event) =>
            onChange({
              ...draft,
              business_type: event.target.value === "foreign" ? "foreign" : "domestic"
            })
          }
        >
          <option value="domestic">内贸</option>
          <option value="foreign">外贸</option>
        </Select>
      </DialogSection>

      <DialogSection>
        <label
          className="text-sm font-black uppercase tracking-[0.14em]"
          htmlFor="template-supplemental-rules"
        >
          我的补充规则
        </label>
        <Textarea
          id="template-supplemental-rules"
          value={draft.supplemental_rules}
          onChange={(event) =>
            onChange({ ...draft, supplemental_rules: event.target.value })
          }
          placeholder={SUPPLEMENTAL_PLACEHOLDER}
          className="min-h-[12rem]"
        />
      </DialogSection>
    </Dialog>
  );
}
