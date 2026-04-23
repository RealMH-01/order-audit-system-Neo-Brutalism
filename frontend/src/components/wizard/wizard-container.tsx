"use client";

import type { ChangeEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Loader2, SkipForward } from "lucide-react";

import {
  apiGet,
  apiPost,
  apiPut,
  clearStoredAccessToken,
  getStoredAccessToken,
  setStoredAccessToken
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
import { StepCompanyInfo } from "@/components/wizard/step-company-info";
import { StepConfirm } from "@/components/wizard/step-confirm";
import { StepIndicator } from "@/components/wizard/step-indicator";
import { StepIndustryTemplate } from "@/components/wizard/step-industry-template";
import { StepModelConfig } from "@/components/wizard/step-model-config";
import { StepRulesConfig } from "@/components/wizard/step-rules-config";
import type {
  WizardAuthResponse,
  WizardChatApiResponse,
  WizardCompleteApiResponse,
  WizardConnectionTestResponse,
  WizardFormState,
  WizardProfile,
  WizardStartApiResponse,
  WizardStepKey,
  WizardTemplateOption
} from "@/components/wizard/types";

const steps: Array<{ key: WizardStepKey; label: string }> = [
  { key: "model", label: "模型与密钥" },
  { key: "template", label: "行业模板" },
  { key: "rules", label: "审核规则" },
  { key: "company", label: "公司架构" },
  { key: "confirm", label: "确认总结" }
];

const templateOptions: WizardTemplateOption[] = [
  {
    id: "generic-trade",
    label: "通用外贸",
    description: "适合标准外贸跟单场景，重点检查 PO、一票单据和常见字段一致性。",
    rulesText:
      "优先核对发票抬头、PO 号、数量、金额、贸易术语、收货人与唛头。出现歧义数字格式时必须升级提示。"
  },
  {
    id: "chemical",
    label: "化工行业",
    description: "适合需要关注品名、规格、批次与包装说明的化工类外贸场景。",
    rulesText:
      "额外关注化学品品名、规格型号、包装方式、危险品说明、批次信息和运输条件。任何规格与包装等级实质差异都应重点提示。"
  },
  {
    id: "blank",
    label: "空白 / 不使用模板",
    description: "不带预置行业规则，从零开始配置你的审核规则。",
    rulesText: ""
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
  selectedTemplateId: "generic-trade",
  ruleMode: "ai",
  manualRulesText: "",
  sessionId: null,
  chatMessages: [],
  chatInput: "",
  generatedRules: [],
  generatedAffiliates: [],
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

function getStepValidationMessage(step: number, state: WizardFormState) {
  if (step === 0 && !state.token) {
    return "请先登录或注册，建立当前引导会话。";
  }

  if (step === 2) {
    if (state.ruleMode === "manual" && !state.manualRulesText.trim()) {
      return "手动模式下请至少填写一条审核规则。";
    }
    if (state.ruleMode === "ai" && state.generatedRules.length === 0) {
      return "AI 路径下请先完成引导，或切换到手动模式继续编辑。";
    }
  }

  if (step === 3 && state.companyMode === "group") {
    if (state.affiliateRoles.length === 0) {
      return "集团模式下请至少填写一个关联公司。";
    }
    if (state.affiliateRoles.some((item) => !item.company.trim())) {
      return "集团模式下每个关联主体都需要填写公司名称。";
    }
  }

  return null;
}

export function WizardContainer() {
  const [form, setForm] = useState<WizardFormState>(initialFormState);
  const [currentStep, setCurrentStep] = useState(0);
  const [pageLoading, setPageLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [completeLoading, setCompleteLoading] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [completeMessage, setCompleteMessage] = useState<string | null>(null);
  const [testStatus, setTestStatus] =
    useState<WizardConnectionTestResponse | null>(null);
  const [testingProvider, setTestingProvider] = useState<
    "openai" | "deepseek" | "zhipuai" | null
  >(null);

  const selectedTemplate = useMemo(
    () =>
      templateOptions.find((item) => item.id === form.selectedTemplateId) ??
      templateOptions[0],
    [form.selectedTemplateId]
  );

  const finalRules = useMemo(
    () =>
      form.ruleMode === "manual"
        ? form.manualRulesText
            .split("\n")
            .map((item) => item.trim())
            .filter(Boolean)
        : form.generatedRules,
    [form.generatedRules, form.manualRulesText, form.ruleMode]
  );

  function updateField<K extends keyof WizardFormState>(
    field: K,
    value: WizardFormState[K]
  ) {
    setForm((previous) => {
      const next = { ...previous, [field]: value };

      if (field === "provider") {
        const provider = value as WizardFormState["provider"];
        next.selectedModel =
          provider === "openai"
            ? "gpt-4o"
            : provider === "deepseek"
              ? "deepseek-chat"
              : "glm-4-flash";
        if (provider === "zhipuai") {
          next.deepThinkEnabled = false;
        }
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
  }

  async function loadProfile(token: string) {
    setProfileLoading(true);
    try {
      const { data } = await apiGet<WizardProfile>("/settings/profile", { token });
      setForm((previous) => {
        const provider = resolveProviderFromModel(data.selected_model);
        const affiliateRoles =
          data.company_affiliates_roles.length > 0
            ? data.company_affiliates_roles
            : data.company_affiliates.map((item) => ({ company: item, role: "" }));

        return {
          ...previous,
          token,
          provider,
          selectedModel: data.selected_model,
          deepThinkEnabled: data.deep_think_enabled && provider !== "zhipuai",
          manualRulesText: data.active_custom_rules.join("\n"),
          generatedRules: data.active_custom_rules,
          generatedAffiliates: data.company_affiliates,
          affiliateRoles,
          companyMode: data.company_affiliates.length > 0 ? "group" : "single"
        };
      });
    } finally {
      setProfileLoading(false);
    }
  }

  const ensureStoredSession = useCallback(async (token: string) => {
    try {
      await apiGet("/auth/me", { token });
      await loadProfile(token);
    } catch {
      clearStoredAccessToken();
      setForm((previous) => ({ ...previous, token: null }));
    }
  }, []);

  useEffect(() => {
    const token = getStoredAccessToken();
    if (!token) {
      setPageLoading(false);
      return;
    }

    void ensureStoredSession(token).finally(() => setPageLoading(false));
  }, [ensureStoredSession]);

  async function handleAuthenticate() {
    setAuthLoading(true);
    setAuthError(null);

    try {
      const path = form.authMode === "login" ? "/auth/login" : "/auth/register";
      const payload =
        form.authMode === "login"
          ? {
              email: form.email,
              password: form.password
            }
          : {
              email: form.email,
              password: form.password,
              display_name: "Wizard User"
            };

      const { data } = await apiPost<WizardAuthResponse>(path, payload);
      setStoredAccessToken(data.access_token);
      await loadProfile(data.access_token);
      setForm((previous) => ({ ...previous, token: data.access_token }));
    } catch (error) {
      setAuthError(
        typeof error === "object" && error && "detail" in error
          ? String(error.detail)
          : "登录或注册失败，请稍后重试。"
      );
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleTestConnection() {
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
            : "连接测试失败，请稍后重试。"
      });
    } finally {
      setTestingProvider(null);
    }
  }

  async function handleStartAi() {
    if (!form.token) {
      setChatError("请先登录后再启动 AI 引导。");
      return;
    }

    setChatLoading(true);
    setChatError(null);

    try {
      const firstMessage = form.manualRulesText.trim()
        ? `我已经手写了一些规则草稿，请你把它们也纳入上下文：\n${form.manualRulesText.trim()}`
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
        chatInput: ""
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
  }

  async function handleSendChat() {
    if (!form.token || !form.sessionId || !form.chatInput.trim()) {
      return;
    }

    const userMessage = form.chatInput.trim();
    setChatLoading(true);
    setChatError(null);

    try {
      const { data } = await apiPost<WizardChatApiResponse>(
        "/wizard/chat",
        {
          session_id: form.sessionId,
          message: userMessage
        },
        { token: form.token }
      );

      setForm((previous) => {
        const generatedRules =
          data.generated_rules.length > 0
            ? data.generated_rules
            : previous.generatedRules;
        const generatedAffiliates =
          data.generated_affiliates.length > 0
            ? data.generated_affiliates
            : previous.generatedAffiliates;

        return {
          ...previous,
          chatMessages: [
            ...previous.chatMessages,
            { role: "user", content: userMessage },
            { role: "assistant", content: data.ai_message }
          ],
          chatInput: "",
          generatedRules,
          generatedAffiliates,
          manualRulesText:
            generatedRules.length > 0
              ? generatedRules.join("\n")
              : previous.manualRulesText
        };
      });
    } catch (error) {
      setChatError(
        typeof error === "object" && error && "detail" in error
          ? String(error.detail)
          : "发送给 AI 失败，请稍后重试。"
      );
    } finally {
      setChatLoading(false);
    }
  }

  function handleImportRules(event: ChangeEvent<HTMLInputElement>) {
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
  }

  function handleCompanyModeChange(mode: "single" | "group") {
    setForm((previous) => ({
      ...previous,
      companyMode: mode,
      affiliateRoles:
        mode === "single"
          ? []
          : previous.affiliateRoles.length > 0
            ? previous.affiliateRoles
            : [{ company: "", role: "" }]
    }));
  }

  function handleApplyGeneratedAffiliates() {
    if (form.generatedAffiliates.length === 0) {
      return;
    }

    setForm((previous) => ({
      ...previous,
      companyMode: "group",
      affiliateRoles: previous.generatedAffiliates.map((item) => {
        const existing = previous.affiliateRoles.find(
          (role) => role.company === item
        );
        return existing ?? { company: item, role: "" };
      })
    }));
  }

  function handleNextStep() {
    const validationMessage = getStepValidationMessage(currentStep, form);
    if (validationMessage) {
      setCompleteError(validationMessage);
      return;
    }

    setCompleteError(null);
    setCurrentStep((previous) => Math.min(previous + 1, steps.length - 1));
  }

  function handlePrevStep() {
    setCompleteError(null);
    setCurrentStep((previous) => Math.max(previous - 1, 0));
  }

  async function handleSubmit() {
    if (!form.token) {
      setCompleteError("请先登录后再完成设置。");
      return;
    }

    if (finalRules.length === 0) {
      setCompleteError("请至少保留一条审核规则后再完成。");
      return;
    }

    setCompleteLoading(true);
    setCompleteError(null);
    setCompleteMessage(null);

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
          deep_think_enabled:
            form.provider === "zhipuai" ? false : form.deepThinkEnabled,
          openai_api_key: form.openaiApiKey || null,
          deepseek_api_key: form.deepseekApiKey || null,
          zhipu_api_key: form.zhipuApiKey || null,
          zhipu_ocr_api_key: form.zhipuOcrApiKey || null,
          company_affiliates: affiliates,
          company_affiliates_roles: affiliateRoles
        },
        { token: form.token }
      );

      const completionPath =
        form.ruleMode === "ai" && form.sessionId
          ? "/wizard/complete"
          : "/wizard/skip";

      const { data } = await apiPost<WizardCompleteApiResponse>(
        completionPath,
        completionPath === "/wizard/complete"
          ? {
              session_id: form.sessionId,
              final_rules: finalRules,
              generated_affiliates: affiliates,
              generated_affiliate_roles: affiliateRoles
            }
          : {
              rules_text: finalRules,
              generated_affiliates: affiliates,
              generated_affiliate_roles: affiliateRoles
            },
        { token: form.token }
      );

      setCompleteMessage(data.message);
      setForm((previous) => ({
        ...previous,
        generatedRules: data.generated_rules,
        generatedAffiliates: data.generated_affiliates
      }));
    } catch (error) {
      setCompleteError(
        typeof error === "object" && error && "detail" in error
          ? String(error.detail)
          : "保存 wizard 配置失败，请稍后重试。"
      );
    } finally {
      setCompleteLoading(false);
    }
  }

  const currentStepContent = (() => {
    switch (steps[currentStep].key) {
      case "model":
        return (
          <StepModelConfig
            email={form.email}
            password={form.password}
            authMode={form.authMode}
            authenticated={Boolean(form.token)}
            authLoading={authLoading}
            authError={authError}
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
            onAuthenticate={handleAuthenticate}
            onTestConnection={handleTestConnection}
          />
        );
      case "template":
        return (
          <StepIndustryTemplate
            options={templateOptions}
            selectedTemplateId={form.selectedTemplateId}
            onSelect={(value) => updateField("selectedTemplateId", value)}
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
            chatLoading={chatLoading}
            chatError={chatError}
            canStartAi={Boolean(form.token)}
            onRuleModeChange={(mode) => updateField("ruleMode", mode)}
            onManualRulesChange={(value) => updateField("manualRulesText", value)}
            onChatInputChange={(value) => updateField("chatInput", value)}
            onStartAi={handleStartAi}
            onSendChat={handleSendChat}
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
            saving={completeLoading}
            completeError={completeError}
            completeMessage={completeMessage}
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
                正在恢复 wizard 会话
              </p>
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
                  这一轮只聚焦 `/wizard` 页面：五步结构、AI/手动双路径、最小真实后端联调，以及沉浸式 Neo-Brutalism 页面收口。
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Badge variant="secondary">全屏沉浸式</Badge>
              <Badge variant="muted">/api/wizard/* 已接线</Badge>
            </div>
          </div>
        </header>

        <StepIndicator
          steps={steps}
          currentStep={currentStep}
          onJump={(index) => {
            setCompleteError(null);
            setCurrentStep(index);
          }}
        />

        {profileLoading ? (
          <Card className="bg-paper">
            <CardContent className="flex items-center gap-3 py-10">
              <Loader2 className="animate-spin" size={22} strokeWidth={3} />
              <p className="text-sm font-bold uppercase tracking-[0.14em]">
                正在同步当前 profile
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
                当前步骤：{steps[currentStep].label}。向前切换时会尽量保留已填写内容、AI 对话状态和模板选择。
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
                {currentStep === 2 && form.ruleMode === "manual" ? (
                  <Button
                    variant="secondary"
                    onClick={handleSubmit}
                    disabled={completeLoading || finalRules.length === 0}
                  >
                    <SkipForward size={18} strokeWidth={3} />
                    跳过 AI 直接完成
                  </Button>
                ) : null}
                <Button onClick={handleNextStep}>
                  下一步
                  <ArrowRight size={18} strokeWidth={3} />
                </Button>
              </div>
            </div>
            {completeError && currentStep !== steps.length - 1 ? (
              <div className="issue-red mt-4 p-4">
                <p className="text-sm font-bold leading-6">{completeError}</p>
              </div>
            ) : null}
          </footer>
        ) : null}
      </div>
    </main>
  );
}
