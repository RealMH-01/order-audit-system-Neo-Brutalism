"use client";

import type { ChangeEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Loader2, SkipForward } from "lucide-react";

import {
  apiGet,
  apiPost,
  apiPut,
  clearStoredAccessToken,
  getStoredAccessToken
} from "@/lib/api";
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
import { StepCompanyInfo } from "@/components/wizard/step-company-info";
import { StepConfirm } from "@/components/wizard/step-confirm";
import { StepIndicator } from "@/components/wizard/step-indicator";
import { StepIndustryTemplate } from "@/components/wizard/step-industry-template";
import { StepModelConfig } from "@/components/wizard/step-model-config";
import { StepRulesConfig } from "@/components/wizard/step-rules-config";
import type {
  WizardAffiliateRole,
  WizardChatApiResponse,
  WizardCompleteApiResponse,
  WizardConnectionTestResponse,
  WizardFormState,
  WizardProfile,
  WizardStartApiResponse,
  WizardStepKey,
  WizardTemplateOption,
  WizardTemplateOptionId
} from "@/components/wizard/types";

const steps: Array<{ key: WizardStepKey; label: string }> = [
  { key: "model", label: "模型与密钥" },
  { key: "template", label: "行业模板" },
  { key: "rules", label: "审核规则" },
  { key: "company", label: "公司架构" },
  { key: "confirm", label: "确认完成" }
];

const templateOptions: WizardTemplateOption[] = [
  {
    id: "generic-trade",
    label: "通用外贸",
    description: "适合标准外贸跟单场景，重点核对 PO、单据关键信息和一致性。",
    rulesText:
      "优先核对抬头、PO 号、合同号、数量、金额、贸易术语、买方、收货人与发货信息；任何数字歧义都必须重点提示。",
    companyAffiliates: []
  },
  {
    id: "chemical",
    label: "化工行业",
    description: "适合需要关注品名、规格、包装、批次和危险品说明的场景。",
    rulesText:
      "额外关注化学品名称、规格型号、包装方式、危险品说明、批次信息和运输条件；任何规格或包装等级差异都应重点提示。",
    companyAffiliates: []
  },
  {
    id: "blank",
    label: "空白 / 不使用模板",
    description: "不带预设规则，从零开始配置审核要求。",
    rulesText: "",
    companyAffiliates: []
  }
];

const initialFormState: WizardFormState = {
  token: null,
  authMode: "login",
  email: "wizard@example.com",
  password: "123456",
  provider: "openai",
  selectedModel: "gpt-4o",
  deepThinkEnabled: false,
  openaiApiKey: "",
  deepseekApiKey: "",
  zhipuApiKey: "",
  zhipuOcrApiKey: "",
  hasOpenaiKey: false,
  hasDeepseekKey: false,
  hasZhipuKey: false,
  hasZhipuOcrKey: false,
  selectedTemplateId: "generic-trade",
  ruleMode: "ai",
  manualRulesText: "",
  sessionId: null,
  chatMessages: [],
  chatInput: "",
  generatedRules: [],
  generatedAffiliates: [],
  aiCompleted: false,
  aiRulesConfirmed: false,
  companyMode: "single",
  affiliateRoles: []
};

function resolveProviderFromModel(model: string) {
  const normalized = model.toLowerCase();
  if (normalized.startsWith("deepseek")) {
    return "deepseek" as const;
  }
  if (normalized.startsWith("glm")) {
    return "zhipuai" as const;
  }
  return "openai" as const;
}

const ZHIPU_LEGACY_MODEL_MAP: Record<string, string> = {
  "glm-4v": "glm-4.6v",
  "glm-4-flash": "glm-4.6v-flash"
};

function normalizeModelForDisplay(model: string) {
  const normalized = model.trim().toLowerCase();
  if (normalized in ZHIPU_LEGACY_MODEL_MAP) {
    return ZHIPU_LEGACY_MODEL_MAP[normalized];
  }
  return model;
}

function getRequiredApiKey(
  provider: WizardFormState["provider"],
  form: WizardFormState
) {
  if (provider === "openai") {
    return form.openaiApiKey.trim() || (form.hasOpenaiKey ? "__saved__" : "");
  }
  if (provider === "deepseek") {
    return form.deepseekApiKey.trim() || (form.hasDeepseekKey ? "__saved__" : "");
  }
  return form.zhipuApiKey.trim() || (form.hasZhipuKey ? "__saved__" : "");
}

function mergeRuleText(existing: string, incoming: string) {
  const lines = [...existing.split("\n"), ...incoming.split("\n")]
    .map((line) => line.trim())
    .filter(Boolean);
  return Array.from(new Set(lines)).join("\n");
}

function mergeAffiliates(
  existing: WizardAffiliateRole[],
  nextCompanies: string[]
): WizardAffiliateRole[] {
  return nextCompanies.map((company) => {
    const matched = existing.find((item) => item.company === company);
    return matched ?? { company, role: "" };
  });
}

function getStepValidationMessage(step: number, state: WizardFormState) {
  if (step === 0) {
    if (!state.token) {
      return "请先登录或注册，再继续后续向导。";
    }
    if (!state.selectedModel.trim()) {
      return "请先选择要使用的模型。";
    }
    if (!getRequiredApiKey(state.provider, state)) {
      return "请填写当前模型对应的必填密钥后再继续。";
    }
  }

  if (step === 1 && !state.selectedTemplateId) {
    return "请先选择一个模板，空白模板也算有效选择。";
  }

  if (step === 2 && state.ruleMode === "ai") {
    if (!state.aiCompleted) {
      return "AI 路径下，必须先让向导完成总结后才能进入下一步。";
    }
    if (!state.aiRulesConfirmed) {
      return "请先确认采用当前 AI 生成的规则。";
    }
  }

  return null;
}

export function WizardContainer() {
  const router = useRouter();
  const [form, setForm] = useState<WizardFormState>(initialFormState);
  const [currentStep, setCurrentStep] = useState(0);
  const [pageLoading, setPageLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [testStatus, setTestStatus] =
    useState<WizardConnectionTestResponse | null>(null);
  const [testingProvider, setTestingProvider] = useState<
    "openai" | "deepseek" | "zhipuai" | null
  >(null);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [pendingTemplateId, setPendingTemplateId] =
    useState<WizardTemplateOptionId | null>(null);
  const [skipDialogOpen, setSkipDialogOpen] = useState(false);
  const [wizardCompleted, setWizardCompleted] = useState(false);
  const [forceRestart, setForceRestart] = useState(false);

  const selectedTemplate = useMemo(
    () =>
      templateOptions.find((item) => item.id === form.selectedTemplateId) ??
      templateOptions[0],
    [form.selectedTemplateId]
  );

  const finalRules = useMemo(() => {
    if (form.ruleMode === "manual") {
      return form.manualRulesText
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return form.generatedRules;
  }, [form.generatedRules, form.manualRulesText, form.ruleMode]);

  const hasTemplateSensitiveState = useMemo(
    () =>
      Boolean(
        form.manualRulesText.trim() ||
          form.generatedRules.length > 0 ||
          form.chatMessages.length > 0
      ),
    [form.chatMessages.length, form.generatedRules.length, form.manualRulesText]
  );

  const loadProfile = useCallback(async (token: string) => {
    setProfileLoading(true);
    try {
      const { data } = await apiGet<WizardProfile>("/settings/profile", { token });
      const provider = resolveProviderFromModel(data.selected_model);
      const affiliateRoles =
        data.company_affiliates_roles.length > 0
          ? data.company_affiliates_roles
          : data.company_affiliates.map((item) => ({ company: item, role: "" }));

      setForm((previous) => ({
        ...previous,
        token,
        provider,
        selectedModel: normalizeModelForDisplay(data.selected_model),
        deepThinkEnabled: data.deep_think_enabled,
        manualRulesText: data.active_custom_rules.join("\n"),
        generatedRules: data.active_custom_rules,
        generatedAffiliates: data.company_affiliates,
        hasOpenaiKey: data.has_openai_key,
        hasDeepseekKey: data.has_deepseek_key,
        hasZhipuKey: data.has_zhipu_key,
        hasZhipuOcrKey: data.has_zhipu_ocr_key,
        aiCompleted: false,
        aiRulesConfirmed: false,
        companyMode: data.company_affiliates.length > 0 ? "group" : "single",
        affiliateRoles
      }));
      setWizardCompleted(data.wizard_completed);
      setForceRestart(false);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  const ensureStoredSession = useCallback(
    async (token: string) => {
      try {
        await apiGet("/auth/me", { token });
        await loadProfile(token);
      } catch {
        clearStoredAccessToken();
        setForm((previous) => ({ ...previous, token: null }));
        router.replace("/login");
      }
    },
    [loadProfile, router]
  );

  useEffect(() => {
    const token = getStoredAccessToken();
    if (!token) {
      setPageLoading(false);
      return;
    }

    void ensureStoredSession(token).finally(() => setPageLoading(false));
  }, [ensureStoredSession]);

  const updateField = useCallback(
    <K extends keyof WizardFormState>(field: K, value: WizardFormState[K]) => {
      setForm((previous) => {
        const next = { ...previous, [field]: value };

        if (field === "provider") {
          const provider = value as WizardFormState["provider"];
          next.selectedModel =
            provider === "openai"
              ? "gpt-4o"
              : provider === "deepseek"
                ? "deepseek-chat"
                : "glm-4.6v";
        }

        if (field === "ruleMode") {
          const nextMode = value as WizardFormState["ruleMode"];
          if (
            nextMode === "manual" &&
            !previous.manualRulesText.trim() &&
            previous.generatedRules.length > 0
          ) {
            next.manualRulesText = previous.generatedRules.join("\n");
          }
        }

        return next;
      });
    },
    []
  );

  const applyTemplateSelection = useCallback(
    (templateId: WizardTemplateOptionId, mode: "direct" | "overwrite" | "append") => {
      const template =
        templateOptions.find((item) => item.id === templateId) ?? templateOptions[0];
      const templateRules = template.rulesText.trim();
      const mergedRoles = mergeAffiliates(
        mode === "overwrite" ? [] : form.affiliateRoles,
        template.companyAffiliates
      );

      setForm((previous) => {
        if (mode === "overwrite") {
          return {
            ...previous,
            selectedTemplateId: templateId,
            manualRulesText: templateRules,
            generatedRules: [],
            generatedAffiliates: template.companyAffiliates,
            aiCompleted: false,
            aiRulesConfirmed: false,
            sessionId: null,
            chatMessages: [],
            chatInput: "",
            companyMode: template.companyAffiliates.length > 0 ? "group" : "single",
            affiliateRoles: mergedRoles
          };
        }

        const nextManualRules =
          mode === "append"
            ? mergeRuleText(previous.manualRulesText, templateRules)
            : previous.manualRulesText.trim()
              ? previous.manualRulesText
              : templateRules;

        return {
          ...previous,
          selectedTemplateId: templateId,
          manualRulesText: nextManualRules,
          generatedAffiliates:
            previous.generatedAffiliates.length > 0
              ? Array.from(
                  new Set([...previous.generatedAffiliates, ...template.companyAffiliates])
                )
              : template.companyAffiliates,
          companyMode:
            mergedRoles.length > 0 || previous.companyMode === "group"
              ? "group"
              : previous.companyMode,
          affiliateRoles:
            mergedRoles.length > 0 ? mergedRoles : previous.affiliateRoles
        };
      });
    },
    [form.affiliateRoles]
  );

  const handleTemplateSelection = useCallback(
    (templateId: WizardTemplateOptionId) => {
      if (templateId === form.selectedTemplateId) {
        return;
      }

      if (!hasTemplateSensitiveState) {
        applyTemplateSelection(templateId, "direct");
        return;
      }

      setPendingTemplateId(templateId);
      setTemplateDialogOpen(true);
    },
    [
      applyTemplateSelection,
      form.selectedTemplateId,
      hasTemplateSensitiveState
    ]
  );

  const handleTemplateDialogAction = useCallback(
    (mode: "overwrite" | "append" | "cancel") => {
      if (mode === "cancel" || !pendingTemplateId) {
        setTemplateDialogOpen(false);
        setPendingTemplateId(null);
        return;
      }

      applyTemplateSelection(pendingTemplateId, mode);
      setTemplateDialogOpen(false);
      setPendingTemplateId(null);
    },
    [applyTemplateSelection, pendingTemplateId]
  );

  const handleTestConnection = useCallback(async () => {
    if (!form.token) {
      setTestStatus({ success: false, message: "请先登录后再测试连接。" });
      return;
    }

    setTestingProvider(form.provider);
    setTestStatus(null);

    try {
      const payload =
        form.provider === "openai"
          ? {
              provider: "openai",
              use_saved_key: !form.openaiApiKey.trim(),
              api_key: form.openaiApiKey || null
            }
          : form.provider === "deepseek"
            ? {
                provider: "deepseek",
                use_saved_key: !form.deepseekApiKey.trim(),
                api_key: form.deepseekApiKey || null
              }
            : {
                provider: "zhipuai",
                use_saved_key: !form.zhipuApiKey.trim(),
                api_key: form.zhipuApiKey || null
              };

      const { data } = await apiPost<WizardConnectionTestResponse>(
        "/settings/test-connection",
        payload,
        { token: form.token }
      );
      setTestStatus(data);
    } catch (error) {
      setTestStatus({
        success: false,
        message:
          typeof error === "object" && error && "detail" in error
            ? String(error.detail)
            : "连接测试失败，请稍后再试。"
      });
    } finally {
      setTestingProvider(null);
    }
  }, [form]);

  const handleStartAi = useCallback(async () => {
    if (!form.token) {
      setChatError("请先登录后再启动 AI 引导。");
      return;
    }

    setChatLoading(true);
    setChatError(null);

    try {
      const firstMessage = form.manualRulesText.trim()
        ? `我已经写了一些规则草稿，请把它们也纳入上下文：\n${form.manualRulesText.trim()}`
        : null;

      const { data } = await apiPost<WizardStartApiResponse>(
        "/wizard/start",
        {
          first_message: firstMessage,
          selected_template:
            selectedTemplate.id === "blank" ? null : selectedTemplate.label,
          template_rules: selectedTemplate.rulesText || null,
          provider: form.provider
        },
        { token: form.token }
      );

      setForm((previous) => ({
        ...previous,
        sessionId: data.session_id,
        chatMessages: [{ role: "assistant", content: data.ai_message }],
        chatInput: "",
        aiCompleted: data.is_complete,
        aiRulesConfirmed: false
      }));
    } catch (error) {
      setChatError(
        typeof error === "object" && error && "detail" in error
          ? String(error.detail)
          : "启动 AI 引导失败，请稍后重试。"
      );
    } finally {
      setChatLoading(false);
    }
  }, [form.manualRulesText, form.provider, form.token, selectedTemplate]);

  const handleSendChatMessage = useCallback(
    async (message: string) => {
      if (!form.token || !form.sessionId || !message.trim()) {
        return;
      }

      setChatLoading(true);
      setChatError(null);

      try {
        const { data } = await apiPost<WizardChatApiResponse>(
          "/wizard/chat",
          {
            session_id: form.sessionId,
            message
          },
          { token: form.token }
        );

        setForm((previous) => {
          const nextGeneratedRules =
            data.generated_rules.length > 0
              ? data.generated_rules
              : previous.generatedRules;
          const nextGeneratedAffiliates =
            data.generated_affiliates.length > 0
              ? data.generated_affiliates
              : previous.generatedAffiliates;

          return {
            ...previous,
            chatMessages: [
              ...previous.chatMessages,
              { role: "user", content: message },
              { role: "assistant", content: data.ai_message }
            ],
            chatInput: "",
            generatedRules: nextGeneratedRules,
            generatedAffiliates: nextGeneratedAffiliates,
            manualRulesText:
              nextGeneratedRules.length > 0
                ? nextGeneratedRules.join("\n")
                : previous.manualRulesText,
            aiCompleted: data.is_complete,
            aiRulesConfirmed: data.is_complete ? previous.aiRulesConfirmed : false
          };
        });
      } catch (error) {
        setChatError(
          typeof error === "object" && error && "detail" in error
            ? String(error.detail)
            : "与 AI 对话失败，请稍后再试。"
        );
      } finally {
        setChatLoading(false);
      }
    },
    [form.sessionId, form.token]
  );

  const handleSendChat = useCallback(async () => {
    if (!form.chatInput.trim()) {
      return;
    }
    await handleSendChatMessage(form.chatInput.trim());
  }, [form.chatInput, handleSendChatMessage]);

  const handleSummarizeNow = useCallback(async () => {
    await handleSendChatMessage(
      "请基于目前已经收集到的信息，现在就总结一版可执行的审核规则，并输出最终结果。"
    );
  }, [handleSendChatMessage]);

  const handleRetryAi = useCallback(async () => {
    if (!form.sessionId) {
      await handleStartAi();
      return;
    }
    if (form.chatInput.trim()) {
      await handleSendChat();
    } else {
      await handleSummarizeNow();
    }
  }, [
    form.chatInput,
    form.sessionId,
    handleSendChat,
    handleStartAi,
    handleSummarizeNow
  ]);

  const handleImportRules = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setForm((previous) => ({
        ...previous,
        manualRulesText: String(reader.result || "")
      }));
    };
    reader.readAsText(file, "utf-8");
  }, []);

  const handleCompanyModeChange = useCallback((mode: "single" | "group") => {
    setForm((previous) => ({
      ...previous,
      companyMode: mode,
      affiliateRoles:
        mode === "single"
          ? previous.affiliateRoles
          : previous.affiliateRoles.length > 0
            ? previous.affiliateRoles
            : [{ company: "", role: "" }]
    }));
  }, []);

  const handleApplyGeneratedAffiliates = useCallback(() => {
    if (form.generatedAffiliates.length === 0) {
      return;
    }

    setForm((previous) => ({
      ...previous,
      companyMode: "group",
      affiliateRoles: mergeAffiliates(
        previous.affiliateRoles,
        previous.generatedAffiliates
      )
    }));
  }, [form.generatedAffiliates.length]);

  const handleNextStep = useCallback(() => {
    const validationMessage = getStepValidationMessage(currentStep, form);
    if (validationMessage) {
      setSubmitError(validationMessage);
      return;
    }

    setSubmitError(null);
    setCurrentStep((previous) => Math.min(previous + 1, steps.length - 1));
  }, [currentStep, form]);

  const handlePrevStep = useCallback(() => {
    setSubmitError(null);
    setCurrentStep((previous) => Math.max(previous - 1, 0));
  }, []);

  const handleFinalize = useCallback(
    async (skipWizard: boolean) => {
      if (!form.token) {
        setSubmitError("请先登录后再完成设置。");
        return;
      }

      setSubmitLoading(true);
      setSubmitError(null);
      setSubmitMessage(null);

      const affiliateRoles =
        form.companyMode === "group"
          ? form.affiliateRoles
              .map((item) => ({
                company: item.company.trim(),
                role: item.role.trim()
              }))
              .filter((item) => item.company)
          : [];
      const affiliates = affiliateRoles.map((item) => item.company);

      try {
        await apiPut(
          "/settings/profile",
          {
            selected_model: form.selectedModel,
            deep_think_enabled: form.deepThinkEnabled,
            openai_api_key: form.openaiApiKey.trim() || undefined,
            deepseek_api_key: form.deepseekApiKey.trim() || undefined,
            zhipu_api_key: form.zhipuApiKey.trim() || undefined,
            zhipu_ocr_api_key: form.zhipuOcrApiKey.trim() || undefined,
            company_affiliates: affiliates,
            company_affiliates_roles: affiliateRoles
          },
          { token: form.token }
        );

        const { data } = await apiPost<WizardCompleteApiResponse>(
          skipWizard || !form.sessionId || form.ruleMode === "manual"
            ? "/wizard/skip"
            : "/wizard/complete",
          skipWizard || !form.sessionId || form.ruleMode === "manual"
            ? {
                rules_text: finalRules,
                generated_affiliates: affiliates,
                generated_affiliate_roles: affiliateRoles
              }
            : {
                session_id: form.sessionId,
                final_rules: finalRules,
                generated_affiliates: affiliates,
                generated_affiliate_roles: affiliateRoles
              },
          { token: form.token }
        );

        setSubmitMessage(data.message);
        setForm((previous) => ({
          ...previous,
          generatedRules: data.generated_rules,
          generatedAffiliates: data.generated_affiliates
        }));
        router.push("/audit");
      } catch (error) {
        setSubmitError(
          typeof error === "object" && error && "detail" in error
            ? String(error.detail)
            : "保存当前向导配置失败，请稍后重试。"
        );
      } finally {
        setSubmitLoading(false);
      }
    },
    [finalRules, form, router]
  );

  const handleSubmit = useCallback(async () => {
    await handleFinalize(false);
  }, [handleFinalize]);

  const handleSkipWizard = useCallback(async () => {
    setSkipDialogOpen(false);
    await handleFinalize(true);
  }, [handleFinalize]);

  const currentStepContent = (() => {
    switch (steps[currentStep].key) {
      case "model":
        return (
          <StepModelConfig
            provider={form.provider}
            selectedModel={form.selectedModel}
            deepThinkEnabled={form.deepThinkEnabled}
            openaiApiKey={form.openaiApiKey}
            deepseekApiKey={form.deepseekApiKey}
            zhipuApiKey={form.zhipuApiKey}
            zhipuOcrApiKey={form.zhipuOcrApiKey}
            testStatus={testStatus}
            testingProvider={testingProvider}
            onFieldChange={(field, value) =>
              updateField(field as keyof WizardFormState, value as never)
            }
            onTestConnection={handleTestConnection}
          />
        );
      case "template":
        return (
          <StepIndustryTemplate
            options={templateOptions}
            selectedTemplateId={form.selectedTemplateId}
            onSelect={handleTemplateSelection}
          />
        );
      case "rules":
        return (
          <StepRulesConfig
            ruleMode={form.ruleMode}
            manualRulesText={form.manualRulesText}
            chatMessages={form.chatMessages}
            chatInput={form.chatInput}
            generatedRules={form.generatedRules}
            generatedAffiliates={form.generatedAffiliates}
            aiCompleted={form.aiCompleted}
            aiRulesConfirmed={form.aiRulesConfirmed}
            chatLoading={chatLoading}
            chatError={chatError}
            canStartAi={Boolean(form.token)}
            onRuleModeChange={(mode) => updateField("ruleMode", mode)}
            onManualRulesChange={(value) => updateField("manualRulesText", value)}
            onChatInputChange={(value) => updateField("chatInput", value)}
            onStartAi={handleStartAi}
            onSendChat={handleSendChat}
            onSummarizeNow={handleSummarizeNow}
            onRetryAi={handleRetryAi}
            onSwitchToManual={() => updateField("ruleMode", "manual")}
            onConfirmAiRules={() =>
              setForm((previous) => ({
                ...previous,
                aiRulesConfirmed: true,
                manualRulesText:
                  previous.generatedRules.length > 0
                    ? previous.generatedRules.join("\n")
                    : previous.manualRulesText
              }))
            }
            onImportTextFile={handleImportRules}
          />
        );
      case "company":
        return (
          <StepCompanyInfo
            companyMode={form.companyMode}
            affiliateRoles={form.affiliateRoles}
            generatedAffiliates={form.generatedAffiliates}
            onCompanyModeChange={handleCompanyModeChange}
            onAddAffiliate={() =>
              setForm((previous) => ({
                ...previous,
                affiliateRoles: [
                  ...previous.affiliateRoles,
                  { company: "", role: "" }
                ]
              }))
            }
            onRemoveAffiliate={(index) =>
              setForm((previous) => ({
                ...previous,
                affiliateRoles: previous.affiliateRoles.filter(
                  (_, currentIndex) => currentIndex !== index
                )
              }))
            }
            onChangeAffiliate={(index, field, value) =>
              setForm((previous) => ({
                ...previous,
                affiliateRoles: previous.affiliateRoles.map(
                  (item, currentIndex) =>
                    currentIndex === index ? { ...item, [field]: value } : item
                )
              }))
            }
            onApplyGeneratedAffiliates={handleApplyGeneratedAffiliates}
          />
        );
      case "confirm":
        return (
          <StepConfirm
            provider={form.provider}
            selectedModel={form.selectedModel}
            deepThinkEnabled={form.deepThinkEnabled}
            selectedTemplate={selectedTemplate}
            ruleMode={form.ruleMode}
            finalRules={finalRules}
            companyMode={form.companyMode}
            affiliateRoles={form.affiliateRoles}
            saving={submitLoading}
            completeError={submitError}
            completeMessage={submitMessage}
            onJumpToStep={setCurrentStep}
            onSubmit={handleSubmit}
          />
        );
      default:
        return null;
    }
  })();

  if (pageLoading) {
    return (
      <main className="min-h-screen px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto flex max-w-7xl items-center justify-center">
          <Card className="w-full max-w-xl bg-paper">
            <CardContent className="flex items-center justify-center gap-3 py-10">
              <Loader2 className="animate-spin" size={22} strokeWidth={3} />
              <p className="text-sm font-bold uppercase tracking-[0.14em]">
                正在恢复向导会话
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  if (wizardCompleted && !forceRestart) {
    return (
      <main className="min-h-screen px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-7xl items-center justify-center">
          <Card className="w-full max-w-3xl bg-paper">
            <CardHeader>
              <div className="flex flex-wrap items-center gap-3">
                <Badge variant="secondary">已完成</Badge>
                <CardTitle>引导配置已完成</CardTitle>
              </div>
              <CardDescription>
                你之前已经完成了引导向导，当前配置摘要如下：
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="border-4 border-ink bg-secondary p-4 shadow-neo-sm">
                  <p className="text-xs font-black uppercase tracking-[0.14em]">当前模型</p>
                  <p className="mt-2 break-words text-lg font-black">{form.selectedModel}</p>
                </div>
                <div className="border-4 border-ink bg-secondary p-4 shadow-neo-sm">
                  <p className="text-xs font-black uppercase tracking-[0.14em]">规则数量</p>
                  <p className="mt-2 text-lg font-black">
                    {form.generatedRules.length > 0 ? `${form.generatedRules.length} 条` : "未配置"}
                  </p>
                </div>
                <div className="border-4 border-ink bg-secondary p-4 shadow-neo-sm">
                  <p className="text-xs font-black uppercase tracking-[0.14em]">公司架构模式</p>
                  <p className="mt-2 text-lg font-black">
                    {form.companyMode === "group" ? "集团多主体" : "单一主体"}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setWizardCompleted(false);
                    setForceRestart(true);
                  }}
                >
                  重新配置引导
                </Button>
                <Button variant="secondary" onClick={() => router.push("/settings")}>
                  前往设置页
                </Button>
                <Button onClick={() => router.push("/audit")}>前往审核工作台</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-7xl flex-col gap-6">
        <header className="neo-panel-accent p-6 md:p-8">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="space-y-3">
              <Badge variant="inverse" className="rotate-[-2deg]">
                Wizard Setup
              </Badge>
              <div className="space-y-2">
                <h1 className="text-4xl font-black uppercase leading-none tracking-tight md:text-6xl">
                  AI 引导向导
                </h1>
                <p className="max-w-3xl text-sm font-bold leading-6 md:text-base">
                  这一轮重点收口向导数据流、路径切换规则、模板切换确认和最终一次性提交，不会把每一步都写库。
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Badge variant="secondary">全屏沉浸式</Badge>
              <Button variant="outline" onClick={() => setSkipDialogOpen(true)}>
                <SkipForward size={18} strokeWidth={3} />
                跳过引导，直接使用
              </Button>
            </div>
          </div>
        </header>

        <StepIndicator
          steps={steps}
          currentStep={currentStep}
          onJump={(index) => {
            setSubmitError(null);
            setCurrentStep(index);
          }}
        />

        {profileLoading ? (
          <Card className="bg-paper">
            <CardContent className="flex items-center gap-3 py-10">
              <Loader2 className="animate-spin" size={22} strokeWidth={3} />
              <p className="text-sm font-bold uppercase tracking-[0.14em]">
                正在同步当前配置
              </p>
            </CardContent>
          </Card>
        ) : (
          <section className="flex-1">{currentStepContent}</section>
        )}

        {currentStep < steps.length - 1 ? (
          <footer className="neo-panel p-4 md:p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <p className="text-sm font-bold leading-6">
                当前步骤：{steps[currentStep].label}。后退时不会清空已填内容；如果回到模板步骤后切换模板，会给出覆盖或保留当前规则的确认。
              </p>
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  onClick={handlePrevStep}
                  disabled={currentStep === 0}
                >
                  <ArrowLeft size={18} strokeWidth={3} />
                  上一步
                </Button>
                <Button onClick={handleNextStep}>
                  下一步
                  <ArrowRight size={18} strokeWidth={3} />
                </Button>
              </div>
            </div>
            {submitError ? (
              <div className="issue-red mt-4 p-4">
                <p className="text-sm font-bold leading-6">{submitError}</p>
              </div>
            ) : null}
          </footer>
        ) : null}
      </div>

      <Dialog
        open={templateDialogOpen}
        onClose={() => handleTemplateDialogAction("cancel")}
        title="切换模板会影响当前规则"
        description="你已经有现有规则或对话记录。请选择是重新开始，还是保留当前规则并把新模板追加进来。"
        footer={
          <>
            <Button variant="outline" onClick={() => handleTemplateDialogAction("cancel")}>
              取消
            </Button>
            <Button variant="secondary" onClick={() => handleTemplateDialogAction("append")}>
              追加并保留当前规则
            </Button>
            <Button onClick={() => handleTemplateDialogAction("overwrite")}>
              覆盖并重新开始
            </Button>
          </>
        }
      >
        <DialogSection>
          <p className="text-sm font-bold leading-6">
            覆盖：会清空当前 AI 对话与已生成规则，以新模板重新开始。
          </p>
          <p className="text-sm font-bold leading-6">
            追加：会保留当前规则和对话，并把新模板规则追加到手动编辑器作为上下文。
          </p>
        </DialogSection>
      </Dialog>

      <Dialog
        open={skipDialogOpen}
        onClose={() => setSkipDialogOpen(false)}
        title="跳过引导，直接使用"
        description="系统会把你当前页面里的配置一次性写入，并直接跳转到审核页。未完成的 AI 对话不会继续。"
        footer={
          <>
            <Button variant="outline" onClick={() => setSkipDialogOpen(false)}>
              继续编辑
            </Button>
            <Button onClick={handleSkipWizard} disabled={submitLoading}>
              {submitLoading ? "处理中..." : "确认跳过"}
            </Button>
          </>
        }
      >
        <DialogSection>
          <p className="text-sm font-bold leading-6">
            这不会自动加载模板到规则库，而是直接把当前页面收集到的模型、规则和公司架构写入当前 profile。
          </p>
        </DialogSection>
      </Dialog>
    </main>
  );
}
