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
import { normalizeApiErrorDetail } from "@/lib/api-error";
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
  WizardStepKey
} from "@/components/wizard/types";

const steps: Array<{ key: WizardStepKey; label: string }> = [
  { key: "model", label: "模型与密钥" },
  { key: "template", label: "业务背景" },
  { key: "rules", label: "审核规则" },
  { key: "company", label: "公司架构" },
  { key: "confirm", label: "确认完成" }
];

const RULES_IMPORT_MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const RULES_IMPORT_MAX_FILE_SIZE_LABEL = "20MB";
const RULES_IMPORT_EXTENSIONS = new Set(["txt"]);
const RULES_IMPORT_MIME_TYPES = new Set(["text/plain"]);

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
  businessBackground: "",
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

function getFileExtension(filename: string) {
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex > 0 ? filename.slice(dotIndex + 1).toLowerCase() : "";
}

function validateRulesImportFile(file: File) {
  const extension = getFileExtension(file.name);
  const hasSupportedExtension = RULES_IMPORT_EXTENSIONS.has(extension);
  const hasSupportedMimeTypeWithoutExtension =
    !extension && RULES_IMPORT_MIME_TYPES.has(file.type);

  if (!hasSupportedExtension && !hasSupportedMimeTypeWithoutExtension) {
    return "文件格式不支持，请上传 .txt 文本文件。";
  }

  if (file.size === 0) {
    return "文件为空，请重新选择有效文件。";
  }

  if (file.size > RULES_IMPORT_MAX_FILE_SIZE_BYTES) {
    return `文件过大，请压缩后重试或更换文件。当前支持 ${RULES_IMPORT_MAX_FILE_SIZE_LABEL} 以内的 .txt 文件。`;
  }

  return null;
}

function isUnreadableRulesText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return true;
  }

  const replacementChars = trimmed.match(/\uFFFD/g)?.length ?? 0;
  if (replacementChars >= 2 || replacementChars / trimmed.length > 0.05) {
    return true;
  }

  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(trimmed);
}

const ZHIPU_LEGACY_MODEL_MAP: Record<string, string> = {
  "glm-4v": "glm-4.6v",
  "glm-4-flash": "glm-4.6v-flash"
};

const DEEPSEEK_LEGACY_MODEL_MAP: Record<string, string> = {
  "deepseek-chat": "deepseek-v4-flash",
  "deepseek-reasoner": "deepseek-v4-pro"
};

function normalizeModelForDisplay(model: string) {
  const normalized = model.trim().toLowerCase();
  if (normalized in DEEPSEEK_LEGACY_MODEL_MAP) {
    return DEEPSEEK_LEGACY_MODEL_MAP[normalized];
  }
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
  const [rulesImportError, setRulesImportError] = useState<string | null>(null);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [testStatus, setTestStatus] =
    useState<WizardConnectionTestResponse | null>(null);
  const [testingProvider, setTestingProvider] = useState<
    "openai" | "deepseek" | "zhipuai" | null
  >(null);
  const [skipDialogOpen, setSkipDialogOpen] = useState(false);
  const [wizardCompleted, setWizardCompleted] = useState(false);
  const [forceRestart, setForceRestart] = useState(false);

  const finalRules = useMemo(() => {
    if (form.ruleMode === "manual") {
      return form.manualRulesText
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return form.generatedRules;
  }, [form.generatedRules, form.manualRulesText, form.ruleMode]);

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
        manualRulesText: "",
        generatedRules: [],
        generatedAffiliates: [],
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
                ? "deepseek-v4-flash"
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
        message: normalizeApiErrorDetail(error, "连接测试失败，请稍后再试。")
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
      const { data } = await apiPost<WizardStartApiResponse>(
        "/wizard/start",
        {
          first_message: null,
          business_background: form.businessBackground.trim() || null,
          provider: form.provider
        },
        { token: form.token }
      );

      setForm((previous) => ({
        ...previous,
        sessionId: data.session_id,
        chatMessages: [{ role: "assistant", content: data.ai_message }],
        chatInput: "",
        manualRulesText: "",
        generatedRules: [],
        generatedAffiliates: [],
        aiCompleted: data.is_complete,
        aiRulesConfirmed: false
      }));
    } catch (error) {
      setChatError(
        normalizeApiErrorDetail(error, "启动 AI 引导失败，请稍后重试。")
      );
    } finally {
      setChatLoading(false);
    }
  }, [form.businessBackground, form.provider, form.token]);

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
          normalizeApiErrorDetail(error, "与 AI 对话失败，请稍后再试。")
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
      setRulesImportError("请先选择要导入的 .txt 文本文件。");
      event.target.value = "";
      return;
    }

    const validationMessage = validateRulesImportFile(file);
    if (validationMessage) {
      setRulesImportError(validationMessage);
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      if (isUnreadableRulesText(text)) {
        setRulesImportError("文件内容无法识别，请重新选择 UTF-8 文本文件。");
        event.target.value = "";
        return;
      }

      setRulesImportError(null);
      setForm((previous) => ({
        ...previous,
        manualRulesText: text
      }));
      event.target.value = "";
    };
    reader.onerror = () => {
      setRulesImportError("文件读取失败，请重新选择有效的 .txt 文本文件。");
      event.target.value = "";
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
          normalizeApiErrorDetail(error, "保存当前向导配置失败，请稍后重试。")
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
            businessBackground={form.businessBackground}
            onBusinessBackgroundChange={(value) =>
              updateField("businessBackground", value)
            }
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
            rulesImportError={rulesImportError}
            canStartAi={Boolean(form.token)}
            onRuleModeChange={(mode) => updateField("ruleMode", mode)}
            onManualRulesChange={(value) => {
              setRulesImportError(null);
              updateField("manualRulesText", value);
            }}
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
            businessBackground={form.businessBackground}
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
                  跟着步骤完成模型、业务背景、审核规则和公司架构设置，之后就可以进入订单审核。
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
                当前步骤：{steps[currentStep].label}。后退时不会清空已填内容；业务背景只会帮助 AI 更好地追问，不会单独保存成规则体系。
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
            这只会保存当前页面收集到的模型、规则和公司架构。业务背景用于辅助 AI 引导，不会单独保存成规则体系。
          </p>
        </DialogSection>
      </Dialog>
    </main>
  );
}
