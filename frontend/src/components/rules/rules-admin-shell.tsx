"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, FolderKanban, Loader2, ShieldCheck, ShieldOff } from "lucide-react";

import { BuiltinRulesPanel } from "@/components/rules/builtin-rules-panel";
import { TemplateEditorPanel } from "@/components/rules/template-editor-panel";
import { TemplateListPanel } from "@/components/rules/template-list-panel";
import type {
  BuiltinRuleFull,
  BuiltinRulePublic,
  BuiltinRuleUpdatePayload,
  MessageResponse,
  TemplateDraft,
  TemplateItem,
  TemplateListResponse,
  TemplateLoadResponse
} from "@/components/rules/types";
import {
  createEmptyTemplateDraft,
  normalizeError,
  parseAffiliateLines,
  resolveTemplateMode,
  sortTemplates,
  toTemplateDraft
} from "@/components/rules/rules-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SectionHeading } from "@/components/ui/section-heading";
import { apiDelete, apiGet, apiPost, apiPut, getStoredAccessToken } from "@/lib/api";
import type { WizardProfile } from "@/components/wizard/types";

export function RulesAdminShell() {
  const router = useRouter();

  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<WizardProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [builtinPublic, setBuiltinPublic] = useState<BuiltinRulePublic | null>(null);
  const [builtinFull, setBuiltinFull] = useState<BuiltinRuleFull | null>(null);
  const [builtinDisplayText, setBuiltinDisplayText] = useState("");
  const [builtinPromptText, setBuiltinPromptText] = useState("");
  const [builtinLoading, setBuiltinLoading] = useState(true);
  const [builtinError, setBuiltinError] = useState<string | null>(null);
  const [builtinSaving, setBuiltinSaving] = useState(false);

  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [templateDraft, setTemplateDraft] = useState<TemplateDraft>(createEmptyTemplateDraft());
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateDeleting, setTemplateDeleting] = useState(false);
  const [templateActionId, setTemplateActionId] = useState<string | null>(null);
  const [templateMutationError, setTemplateMutationError] = useState<string | null>(null);

  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(
    null
  );

  const loadProfile = useCallback(async (accessToken: string) => {
    setProfileLoading(true);
    setProfileError(null);

    try {
      const { data } = await apiGet<WizardProfile>("/settings/profile", {
        token: accessToken
      });
      setProfile(data);
      return data;
    } catch (error) {
      setProfile(null);
      setProfileError(normalizeError(error, "读取当前账号资料失败，请稍后重试。"));
      return null;
    } finally {
      setProfileLoading(false);
    }
  }, []);

  const loadBuiltin = useCallback(async (accessToken: string, role: WizardProfile["role"]) => {
    setBuiltinLoading(true);
    setBuiltinError(null);

    try {
      const { data: publicData } = await apiGet<BuiltinRulePublic>("/rules/builtin", {
        token: accessToken
      });
      setBuiltinPublic(publicData);
      setBuiltinFull(null);
      setBuiltinDisplayText(publicData.display_text);
      setBuiltinPromptText("");

      if (role === "admin") {
        const { data: fullData } = await apiGet<BuiltinRuleFull>("/rules/builtin/full", {
          token: accessToken
        });
        setBuiltinFull(fullData);
        setBuiltinDisplayText(fullData.display_text);
        setBuiltinPromptText(fullData.prompt_text);
      }
    } catch (error) {
      setBuiltinError(normalizeError(error, "读取系统规则失败，请稍后重试。"));
    } finally {
      setBuiltinLoading(false);
    }
  }, []);

  const loadTemplates = useCallback(
    async (accessToken: string) => {
      setTemplatesLoading(true);
      setTemplatesError(null);

      try {
        const { data } = await apiGet<TemplateListResponse>("/rules/templates", {
          token: accessToken
        });

        const sortedTemplates = sortTemplates(data.templates);
        setTemplates(sortedTemplates);

        if (!creatingTemplate) {
          setSelectedTemplateId((current) => {
            if (current && sortedTemplates.some((template) => template.id === current)) {
              return current;
            }

            return sortedTemplates[0]?.id ?? null;
          });
        }
      } catch (error) {
        setTemplatesError(normalizeError(error, "读取模板列表失败，请稍后重试。"));
      } finally {
        setTemplatesLoading(false);
      }
    },
    [creatingTemplate]
  );

  useEffect(() => {
    const accessToken = getStoredAccessToken();
    setToken(accessToken);

    if (!accessToken) {
      setProfileLoading(false);
      setBuiltinLoading(false);
      setTemplatesLoading(false);
      return;
    }

    void (async () => {
      const currentProfile = await loadProfile(accessToken);
      if (!currentProfile) {
        setBuiltinLoading(false);
        setTemplatesLoading(false);
        return;
      }

      await Promise.all([
        loadBuiltin(accessToken, currentProfile.role),
        loadTemplates(accessToken)
      ]);
    })();
  }, [loadBuiltin, loadProfile, loadTemplates]);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId, templates]
  );

  const templateMode = useMemo(
    () => resolveTemplateMode(selectedTemplate, profile?.role ?? null, profile?.id ?? null),
    [profile?.id, profile?.role, selectedTemplate]
  );

  useEffect(() => {
    if (creatingTemplate) {
      return;
    }

    if (selectedTemplate) {
      setTemplateDraft(toTemplateDraft(selectedTemplate));
      setTemplateMutationError(null);
    }
  }, [creatingTemplate, selectedTemplate]);

  const builtinDirty = useMemo(() => {
    if (profile?.role !== "admin" || !builtinFull) {
      return false;
    }

    return (
      builtinDisplayText !== builtinFull.display_text || builtinPromptText !== builtinFull.prompt_text
    );
  }, [builtinDisplayText, builtinFull, builtinPromptText, profile?.role]);

  const handleSelectTemplate = useCallback((templateId: string) => {
    setCreatingTemplate(false);
    setSelectedTemplateId(templateId);
    setTemplateMutationError(null);
  }, []);

  const handleCreateTemplate = useCallback(() => {
    setCreatingTemplate(true);
    setSelectedTemplateId(null);
    setTemplateDraft(createEmptyTemplateDraft());
    setTemplateMutationError(null);
    setFeedback(null);
  }, []);

  const handleResetTemplate = useCallback(() => {
    if (creatingTemplate || !selectedTemplate) {
      setTemplateDraft(createEmptyTemplateDraft());
      return;
    }

    setTemplateDraft(toTemplateDraft(selectedTemplate));
    setTemplateMutationError(null);
  }, [creatingTemplate, selectedTemplate]);

  const handleSaveBuiltin = useCallback(async () => {
    if (!token || profile?.role !== "admin") {
      return;
    }

    if (!builtinDisplayText.trim() || !builtinPromptText.trim()) {
      setFeedback({
        tone: "error",
        message: "系统规则保存前请完整填写展示规则和 Prompt 规则。"
      });
      return;
    }

    setBuiltinSaving(true);
    setFeedback(null);

    const payload: BuiltinRuleUpdatePayload = {
      display_text: builtinDisplayText.trim(),
      prompt_text: builtinPromptText.trim()
    };

    try {
      const { data } = await apiPut<BuiltinRuleFull>("/rules/builtin", payload, {
        token
      });
      setBuiltinFull(data);
      setBuiltinPublic(data);
      setBuiltinDisplayText(data.display_text);
      setBuiltinPromptText(data.prompt_text);
      setFeedback({ tone: "success", message: "系统规则已保存，当前管理员修改已经写回后端接口。" });
    } catch (error) {
      setFeedback({ tone: "error", message: normalizeError(error, "保存系统规则失败，请稍后重试。") });
    } finally {
      setBuiltinSaving(false);
    }
  }, [builtinDisplayText, builtinPromptText, profile?.role, token]);

  const handleSaveTemplate = useCallback(async () => {
    if (!token) {
      return;
    }

    if (!templateDraft.name.trim() || !templateDraft.rulesText.trim()) {
      setTemplateMutationError("模板名称和规则内容不能为空。");
      return;
    }

    setTemplateSaving(true);
    setTemplateMutationError(null);
    setFeedback(null);

    const payload = {
      name: templateDraft.name.trim(),
      description: templateDraft.description.trim(),
      rules_text: templateDraft.rulesText.trim(),
      company_affiliates: parseAffiliateLines(templateDraft.companyAffiliatesText)
    };

    try {
      if (creatingTemplate) {
        const { data } = await apiPost<TemplateItem>("/rules/templates", payload, {
          token
        });
        await loadTemplates(token);
        setCreatingTemplate(false);
        setSelectedTemplateId(data.id);
        setFeedback({ tone: "success", message: "用户模板创建成功，已加入模板列表。" });
        return;
      }

      if (!selectedTemplate) {
        setTemplateMutationError("当前没有选中的模板，无法保存。");
        return;
      }

      const { data } = await apiPut<TemplateItem>(
        `/rules/templates/${selectedTemplate.id}`,
        payload,
        { token }
      );
      await loadTemplates(token);
      setSelectedTemplateId(data.id);
      setFeedback({
        tone: "success",
        message: data.is_system ? "系统模板已更新。" : "模板修改已保存。"
      });
    } catch (error) {
      setTemplateMutationError(normalizeError(error, "保存模板失败，请稍后重试。"));
    } finally {
      setTemplateSaving(false);
    }
  }, [creatingTemplate, loadTemplates, selectedTemplate, templateDraft, token]);

  const handleDeleteTemplate = useCallback(async () => {
    if (!token || !selectedTemplate) {
      return;
    }

    if (typeof window !== "undefined") {
      const confirmed = window.confirm(`确认删除模板“${selectedTemplate.name}”吗？`);
      if (!confirmed) {
        return;
      }
    }

    setTemplateDeleting(true);
    setTemplateMutationError(null);
    setFeedback(null);

    try {
      const { data } = await apiDelete<MessageResponse>(`/rules/templates/${selectedTemplate.id}`, {
        token
      });
      await loadTemplates(token);
      setCreatingTemplate(false);
      setSelectedTemplateId(null);
      setTemplateDraft(createEmptyTemplateDraft());
      setFeedback({ tone: "success", message: data.message || "模板已删除。" });
    } catch (error) {
      setTemplateMutationError(normalizeError(error, "删除模板失败，请稍后重试。"));
    } finally {
      setTemplateDeleting(false);
    }
  }, [loadTemplates, selectedTemplate, token]);

  const handleLoadTemplate = useCallback(
    async (templateId: string) => {
      if (!token) {
        return;
      }

      setTemplateActionId(templateId);
      setFeedback(null);

      try {
        const { data } = await apiPost<TemplateLoadResponse>(
          `/rules/templates/${templateId}/load`,
          undefined,
          { token }
        );
        setFeedback({
          tone: "success",
          message: `${data.message} 你现在可以前往 /settings 查看当前自定义规则。`
        });
      } catch (error) {
        setFeedback({ tone: "error", message: normalizeError(error, "加载模板失败，请稍后重试。") });
      } finally {
        setTemplateActionId(null);
      }
    },
    [token]
  );

  if (profileLoading) {
    return (
      <section className="space-y-6">
        <Card className="bg-paper">
          <CardContent className="flex items-center gap-3 py-10">
            <Loader2 className="animate-spin" size={20} strokeWidth={3} />
            <p className="text-sm font-bold uppercase tracking-[0.14em]">
              正在读取规则管理页所需配置
            </p>
          </CardContent>
        </Card>
      </section>
    );
  }

  if (!token) {
    return (
      <section className="space-y-6">
        <SectionHeading
          title="规则管理"
          description="规则管理页依赖当前登录态。请先完成登录或向导配置，再回来查看系统规则和模板。"
          icon={FolderKanban}
        />
        <Card className="bg-paper">
          <CardHeader>
            <Badge variant="accent">未登录</Badge>
            <CardTitle>请先进入向导或完成登录</CardTitle>
            <CardDescription>
              `/admin/rules` 会读取当前账号的角色、系统规则和模板权限边界，没有 token 时不会继续请求规则接口。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button onClick={() => router.push("/wizard")}>
              <ArrowRight size={18} strokeWidth={3} />
              前往新手向导
            </Button>
            <Button variant="outline" onClick={() => router.push("/settings")}>
              前往设置页
            </Button>
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <SectionHeading
        title="规则管理"
        description="这里用于查看通用系统规则、维护可编辑的 built-in 规则，以及管理系统模板和当前用户模板。页面会严格遵守现有读写权限边界。"
        icon={FolderKanban}
      />

      {profileError ? (
        <div className="issue-red p-4">
          <p className="text-sm font-bold leading-6">{profileError}</p>
        </div>
      ) : null}

      {feedback ? (
        <div className={feedback.tone === "success" ? "issue-blue p-4" : "issue-red p-4"}>
          <p className="text-sm font-bold leading-6">{feedback.message}</p>
        </div>
      ) : null}

      <Card className="bg-acid">
        <CardContent className="py-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap gap-3">
                <Badge variant="inverse">
                  当前角色：{profile?.role === "admin" ? "管理员" : "普通用户"}
                </Badge>
                <Badge variant="secondary">
                  当前可见模板：系统模板 + {profile?.role === "admin" ? "当前管理员自己的模板" : "当前用户自己的模板"}
                </Badge>
              </div>
              <p className="max-w-3xl text-sm font-bold leading-6">
                普通用户可查看系统规则和系统模板，只能维护自己的模板；管理员可修改 built-in 系统规则，并可按当前 API 能力维护系统模板，但不会默认拥有其他用户模板的编辑权。
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={() => router.push("/settings")}>
                前往当前规则配置
              </Button>
              <Button onClick={() => router.push("/wizard")}>返回向导入口</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[0.78fr_1.22fr]">
        <Card className="bg-muted">
          <CardHeader>
            <Badge variant={profile?.role === "admin" ? "secondary" : "muted"}>
              权限边界
            </Badge>
            <CardTitle>当前账号在本页可做什么？</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
              <p className="flex items-center gap-2 text-sm font-bold leading-6">
                {profile?.role === "admin" ? (
                  <ShieldCheck size={18} strokeWidth={3} />
                ) : (
                  <ShieldOff size={18} strokeWidth={3} />
                )}
                {profile?.role === "admin"
                  ? "你当前是管理员：可读取并修改系统 built-in 规则。"
                  : "你当前是普通用户：系统 built-in 规则为只读查看。"}
              </p>
            </div>
            <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
              <p className="text-sm font-bold leading-6">
                系统模板：所有登录用户可查看和加载；只有管理员可修改或删除系统模板。
              </p>
            </div>
            <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
              <p className="text-sm font-bold leading-6">
                用户模板：当前页面只展示你自己创建的模板，因此无论普通用户还是管理员，都不会默认获得其他用户模板的编辑权。
              </p>
            </div>
          </CardContent>
        </Card>

        <BuiltinRulesPanel
          role={profile?.role ?? null}
          loading={builtinLoading}
          error={builtinError}
          publicRule={builtinPublic}
          fullRule={builtinFull}
          displayText={builtinDisplayText}
          promptText={builtinPromptText}
          saving={builtinSaving}
          onDisplayTextChange={setBuiltinDisplayText}
          onPromptTextChange={setBuiltinPromptText}
          onSave={() => void handleSaveBuiltin()}
          onReset={() => {
            if (profile?.role === "admin" && builtinFull) {
              setBuiltinDisplayText(builtinFull.display_text);
              setBuiltinPromptText(builtinFull.prompt_text);
              return;
            }

            if (builtinPublic) {
              setBuiltinDisplayText(builtinPublic.display_text);
            }
          }}
          onRetry={() => {
            if (!token || !profile) {
              return;
            }

            void loadBuiltin(token, profile.role);
          }}
        />
      </div>

      {builtinDirty && profile?.role === "admin" ? (
        <div className="issue-yellow p-4">
          <p className="text-sm font-bold leading-6">
            系统规则存在未保存修改。点击“保存系统规则”后才会真正写回 `/api/rules/builtin`。
          </p>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <TemplateListPanel
          role={profile?.role ?? null}
          currentUserId={profile?.id ?? null}
          templates={templates}
          loading={templatesLoading}
          error={templatesError}
          activeId={creatingTemplate ? null : selectedTemplateId}
          actionTemplateId={templateActionId}
          onSelect={handleSelectTemplate}
          onCreate={handleCreateTemplate}
          onLoad={(templateId) => void handleLoadTemplate(templateId)}
          onRetry={() => {
            if (!token) {
              return;
            }

            void loadTemplates(token);
          }}
        />

        <TemplateEditorPanel
          role={profile?.role ?? null}
          currentUserId={profile?.id ?? null}
          mode={creatingTemplate ? "create" : templateMode}
          template={creatingTemplate ? null : selectedTemplate}
          draft={templateDraft}
          saving={templateSaving}
          deleting={templateDeleting}
          mutationError={templateMutationError}
          onChange={setTemplateDraft}
          onSave={() => void handleSaveTemplate()}
          onDelete={() => void handleDeleteTemplate()}
          onReset={handleResetTemplate}
        />
      </div>
    </section>
  );
}
