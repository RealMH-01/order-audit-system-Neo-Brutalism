"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Cable,
  CheckCircle2,
  Loader2,
  RotateCcw,
  Save
} from "lucide-react";

import { apiGet, apiPost, apiPut, getStoredAccessToken } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type {
  WizardAffiliateRole,
  WizardConnectionTestResponse,
  WizardProfile,
  WizardProvider
} from "@/components/wizard/types";

type SettingsState = {
  displayName: string;
  provider: WizardProvider;
  selectedModel: string;
  deepThinkEnabled: boolean;
  openaiApiKey: string;
  deepseekApiKey: string;
  zhipuApiKey: string;
  zhipuOcrApiKey: string;
  hasOpenaiKey: boolean;
  hasDeepseekKey: boolean;
  hasZhipuKey: boolean;
  hasZhipuOcrKey: boolean;
  companyMode: "single" | "group";
  affiliateRoles: WizardAffiliateRole[];
  rulesText: string;
  wizardCompleted: boolean;
  disclaimerAccepted: boolean;
};

const providerModels: Record<
  WizardProvider,
  Array<{ label: string; value: string }>
> = {
  openai: [
    { label: "OpenAI GPT-4o", value: "gpt-4o" },
    { label: "OpenAI o3-mini", value: "o3-mini" }
  ],
  deepseek: [
    { label: "DeepSeek V4 Flash", value: "deepseek-v4-flash" },
    { label: "DeepSeek V4 Pro", value: "deepseek-v4-pro" }
  ],
  zhipuai: [
    { label: "智谱 GLM-4-Flash", value: "glm-4-flash" },
    { label: "智谱 GLM-4V", value: "glm-4v" }
  ]
};

const initialState: SettingsState = {
  displayName: "",
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
  companyMode: "single",
  affiliateRoles: [],
  rulesText: "",
  wizardCompleted: false,
  disclaimerAccepted: false
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

// DeepSeek 旧模型名在前端向 V4 归一化，保证下拉框可以正确展示当前选中项。
// 后端依然保留对旧值的兼容，这里只是视觉层面的迁移。
const DEEPSEEK_LEGACY_MODEL_MAP: Record<string, string> = {
  "deepseek-chat": "deepseek-v4-flash",
  "deepseek-reasoner": "deepseek-v4-pro"
};

function normalizeModelForDisplay(model: string) {
  const normalized = model.trim().toLowerCase();
  if (normalized in DEEPSEEK_LEGACY_MODEL_MAP) {
    return DEEPSEEK_LEGACY_MODEL_MAP[normalized];
  }
  return model;
}

export function SettingsShell() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [testStatus, setTestStatus] =
    useState<WizardConnectionTestResponse | null>(null);
  const [testingProvider, setTestingProvider] =
    useState<WizardProvider | null>(null);
  const [state, setState] = useState<SettingsState>(initialState);

  const currentHasKey = useMemo(() => {
    if (state.provider === "openai") {
      return state.hasOpenaiKey;
    }
    if (state.provider === "deepseek") {
      return state.hasDeepseekKey;
    }
    return state.hasZhipuKey;
  }, [state.hasDeepseekKey, state.hasOpenaiKey, state.hasZhipuKey, state.provider]);

  const loadProfile = useCallback(async (accessToken: string) => {
    setLoading(true);
    setError(null);

    try {
      const { data } = await apiGet<WizardProfile>("/settings/profile", {
        token: accessToken
      });
      const provider = resolveProviderFromModel(data.selected_model);
      const displayModel = normalizeModelForDisplay(data.selected_model);
      const affiliateRoles =
        data.company_affiliates_roles.length > 0
          ? data.company_affiliates_roles
          : data.company_affiliates.map((company) => ({ company, role: "" }));

      setState({
        displayName: data.display_name ?? "",
        provider,
        selectedModel: displayModel,
        deepThinkEnabled: data.deep_think_enabled && provider !== "zhipuai",
        openaiApiKey: "",
        deepseekApiKey: "",
        zhipuApiKey: "",
        zhipuOcrApiKey: "",
        hasOpenaiKey: data.has_openai_key,
        hasDeepseekKey: data.has_deepseek_key,
        hasZhipuKey: data.has_zhipu_key,
        hasZhipuOcrKey: data.has_zhipu_ocr_key,
        companyMode: affiliateRoles.length > 0 ? "group" : "single",
        affiliateRoles,
        rulesText: data.active_custom_rules.join("\n"),
        wizardCompleted: data.wizard_completed,
        disclaimerAccepted: data.disclaimer_accepted
      });
    } catch (loadError) {
      setError(
        typeof loadError === "object" && loadError && "detail" in loadError
          ? String(loadError.detail)
          : "读取当前设置失败，请稍后重试。"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const accessToken = getStoredAccessToken();
    setToken(accessToken);

    if (!accessToken) {
      setLoading(false);
      return;
    }

    void loadProfile(accessToken);
  }, [loadProfile]);

  const updateField = useCallback(
    <K extends keyof SettingsState>(field: K, value: SettingsState[K]) => {
      setState((previous) => {
        const next = { ...previous, [field]: value };
        if (field === "provider") {
          const provider = value as SettingsState["provider"];
          next.selectedModel =
            provider === "openai"
              ? "gpt-4o"
              : provider === "deepseek"
                ? "deepseek-v4-flash"
                : "glm-4-flash";
          if (provider === "zhipuai") {
            next.deepThinkEnabled = false;
          }
        }
        return next;
      });
    },
    []
  );

  const handleTestConnection = useCallback(async () => {
    if (!token) {
      setTestStatus({ success: false, message: "请先登录后再测试连接。" });
      return;
    }

    setTestingProvider(state.provider);
    setTestStatus(null);

    try {
      const payload =
        state.provider === "openai"
          ? {
              provider: "openai",
              use_saved_key: !state.openaiApiKey.trim(),
              api_key: state.openaiApiKey.trim() || null
            }
          : state.provider === "deepseek"
            ? {
                provider: "deepseek",
                use_saved_key: !state.deepseekApiKey.trim(),
                api_key: state.deepseekApiKey.trim() || null
              }
            : {
                provider: "zhipuai",
                use_saved_key: !state.zhipuApiKey.trim(),
                api_key: state.zhipuApiKey.trim() || null
              };

      const { data } = await apiPost<WizardConnectionTestResponse>(
        "/settings/test-connection",
        payload,
        { token }
      );
      setTestStatus(data);
    } catch (testError) {
      setTestStatus({
        success: false,
        message:
          typeof testError === "object" && testError && "detail" in testError
            ? String(testError.detail)
            : "连接测试失败，请稍后再试。"
      });
    } finally {
      setTestingProvider(null);
    }
  }, [state, token]);

  const handleSave = useCallback(async () => {
    if (!token) {
      setError("当前没有有效登录态，无法保存设置。");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    const affiliateRoles =
      state.companyMode === "group"
        ? state.affiliateRoles
            .map((item) => ({
              company: item.company.trim(),
              role: item.role.trim()
            }))
            .filter((item) => item.company)
        : [];

    try {
      await apiPut(
        "/settings/profile",
        {
          display_name: state.displayName.trim() || null,
          selected_model: state.selectedModel,
          deep_think_enabled:
            state.provider === "zhipuai" ? false : state.deepThinkEnabled,
          company_affiliates: affiliateRoles.map((item) => item.company),
          company_affiliates_roles: affiliateRoles,
          ...(state.openaiApiKey.trim()
            ? { openai_api_key: state.openaiApiKey.trim() }
            : {}),
          ...(state.deepseekApiKey.trim()
            ? { deepseek_api_key: state.deepseekApiKey.trim() }
            : {}),
          ...(state.zhipuApiKey.trim()
            ? { zhipu_api_key: state.zhipuApiKey.trim() }
            : {}),
          ...(state.zhipuOcrApiKey.trim()
            ? { zhipu_ocr_api_key: state.zhipuOcrApiKey.trim() }
            : {})
        },
        { token }
      );

      await apiPut(
        "/rules/custom",
        {
          rules: state.rulesText
            .split("\n")
            .map((item) => item.trim())
            .filter(Boolean)
        },
        { token }
      );

      setSuccess("设置已保存，wizard 和 settings 现在会读取同一套配置。");
      await loadProfile(token);
    } catch (saveError) {
      setError(
        typeof saveError === "object" && saveError && "detail" in saveError
          ? String(saveError.detail)
          : "保存设置失败，请稍后重试。"
      );
    } finally {
      setSaving(false);
    }
  }, [loadProfile, state, token]);

  if (loading) {
    return (
      <section className="space-y-6">
        <Card className="bg-paper">
          <CardContent className="flex items-center gap-3 py-10">
            <Loader2 className="animate-spin" size={20} strokeWidth={3} />
            <p className="text-sm font-bold uppercase tracking-[0.14em]">
              正在读取当前设置
            </p>
          </CardContent>
        </Card>
      </section>
    );
  }

  if (!token) {
    return (
      <section className="space-y-6">
        <Card className="bg-paper">
          <CardHeader>
            <Badge variant="accent">Settings</Badge>
            <CardTitle>请先进入向导或完成登录</CardTitle>
            <CardDescription>
              当前 settings 页面依赖现有登录态。你可以先进入 wizard，完成最小登录后再回来维护配置。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button onClick={() => router.push("/wizard")}>
              <ArrowRight size={18} strokeWidth={3} />
              前往引导向导
            </Button>
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <Card className="bg-acid">
        <CardHeader className="md:flex-row md:items-end md:justify-between">
          <div className="space-y-3">
            <Badge variant="inverse" className="rotate-[-2deg]">
              Settings
            </Badge>
            <div className="space-y-2">
              <CardTitle>统一维护当前 profile 与规则</CardTitle>
              <CardDescription>
                这里直接维护 wizard 已经生成或将要生成的模型、密钥、规则与公司架构配置。
              </CardDescription>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => router.push("/wizard")}>
              <RotateCcw size={18} strokeWidth={3} />
              {state.wizardCompleted ? "重新运行引导向导" : "继续完成引导向导"}
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              <Save size={18} strokeWidth={3} />
              {saving ? "保存中..." : "保存设置"}
            </Button>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="bg-paper">
          <CardHeader>
            <Badge variant="secondary">基础信息</Badge>
            <CardTitle>显示名与模型配置</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="space-y-2">
              <span className="text-sm font-bold uppercase tracking-[0.14em]">
                显示名称
              </span>
              <Input
                value={state.displayName}
                onChange={(event) => updateField("displayName", event.target.value)}
                placeholder="例如：外贸审核专员"
              />
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-bold uppercase tracking-[0.14em]">
                  Provider
                </span>
                <Select
                  value={state.provider}
                  onChange={(event) =>
                    updateField(
                      "provider",
                      event.target.value as SettingsState["provider"]
                    )
                  }
                >
                  <option value="openai">OpenAI</option>
                  <option value="deepseek">DeepSeek</option>
                  <option value="zhipuai">智谱 GLM</option>
                </Select>
              </label>
              <label className="space-y-2">
                <span className="text-sm font-bold uppercase tracking-[0.14em]">
                  模型
                </span>
                <Select
                  value={state.selectedModel}
                  onChange={(event) =>
                    updateField("selectedModel", event.target.value)
                  }
                >
                  {providerModels[state.provider].map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </Select>
              </label>
            </div>

            <div className="border-4 border-ink bg-secondary p-4 shadow-neo-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-sm font-black uppercase tracking-[0.14em]">
                    深度思考
                  </p>
                  <p className="text-sm font-bold leading-6">
                    {state.provider === "zhipuai"
                      ? "智谱当前不支持深度思考，这个开关会自动禁用。"
                      : "该开关会和 wizard 使用同一份 deep_think_enabled 状态。"}
                  </p>
                </div>
                <Button
                  variant={state.deepThinkEnabled ? "primary" : "outline"}
                  onClick={() =>
                    updateField("deepThinkEnabled", !state.deepThinkEnabled)
                  }
                  disabled={state.provider === "zhipuai"}
                >
                  {state.provider === "zhipuai"
                    ? "已禁用"
                    : state.deepThinkEnabled
                      ? "已开启"
                      : "已关闭"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-muted">
          <CardHeader>
            <Badge variant="inverse">Wizard 状态</Badge>
            <CardTitle>当前引导完成情况</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
              <p className="text-sm font-bold leading-6">
                引导状态：{state.wizardCompleted ? "已完成" : "未完成"}
              </p>
            </div>
            <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
              <p className="text-sm font-bold leading-6">
                免责声明：{state.disclaimerAccepted ? "已接受" : "尚未接受"}
              </p>
            </div>
            <div className="issue-blue p-4">
              <p className="text-sm font-bold leading-6">
                完成向导后会跳转到审核页；如果免责声明尚未确认，将在审核页再弹出，而不是在向导之前打断流程。
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="bg-secondary">
          <CardHeader>
            <Badge variant="inverse">密钥状态</Badge>
            <CardTitle>API Key 与连接测试</CardTitle>
            <CardDescription>
              这里展示 has_xxx_key 状态。输入新密钥后保存即可更新，留空则默认保留已保存密钥。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <Badge variant={state.hasOpenaiKey ? "secondary" : "neutral"}>
                OpenAI {state.hasOpenaiKey ? "已保存" : "未保存"}
              </Badge>
              <Badge variant={state.hasDeepseekKey ? "secondary" : "neutral"}>
                DeepSeek {state.hasDeepseekKey ? "已保存" : "未保存"}
              </Badge>
              <Badge variant={state.hasZhipuKey ? "secondary" : "neutral"}>
                智谱 {state.hasZhipuKey ? "已保存" : "未保存"}
              </Badge>
              <Badge variant={state.hasZhipuOcrKey ? "secondary" : "neutral"}>
                智谱 OCR {state.hasZhipuOcrKey ? "已保存" : "未保存"}
              </Badge>
            </div>

            <label className="space-y-2">
              <span className="text-sm font-bold uppercase tracking-[0.14em]">
                {state.provider === "openai"
                  ? "OpenAI API Key"
                  : state.provider === "deepseek"
                    ? "DeepSeek API Key"
                    : "智谱 API Key"}
              </span>
              <Input
                type="password"
                value={
                  state.provider === "openai"
                    ? state.openaiApiKey
                    : state.provider === "deepseek"
                      ? state.deepseekApiKey
                      : state.zhipuApiKey
                }
                onChange={(event) =>
                  updateField(
                    state.provider === "openai"
                      ? "openaiApiKey"
                      : state.provider === "deepseek"
                        ? "deepseekApiKey"
                        : "zhipuApiKey",
                    event.target.value
                  )
                }
                placeholder={
                  currentHasKey
                    ? "已有保存密钥，如需更新可直接输入新的值"
                    : "请输入当前 provider 的 API Key"
                }
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-bold uppercase tracking-[0.14em]">
                智谱 OCR 补充密钥
              </span>
              <Input
                type="password"
                value={state.zhipuOcrApiKey}
                onChange={(event) =>
                  updateField("zhipuOcrApiKey", event.target.value)
                }
                placeholder={
                  state.hasZhipuOcrKey
                    ? "已有保存密钥，如需更新可直接输入新的值"
                    : "如需给 DeepSeek 场景补 OCR，可在这里填写"
                }
              />
            </label>

            <Button
              variant="secondary"
              onClick={handleTestConnection}
              disabled={testingProvider !== null}
            >
              <Cable size={18} strokeWidth={3} />
              {testingProvider ? "测试中..." : "测试当前连接"}
            </Button>

            {testStatus ? (
              <div
                className={`${testStatus.success ? "issue-blue" : "issue-red"} p-4`}
              >
                <p className="text-sm font-bold leading-6">
                  {testStatus.message}
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="bg-paper">
          <CardHeader>
            <Badge variant="muted">公司架构</Badge>
            <CardTitle>和 wizard 保持同一份公司信息</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <Button
                variant={state.companyMode === "single" ? "primary" : "outline"}
                onClick={() => updateField("companyMode", "single")}
              >
                独立公司
              </Button>
              <Button
                variant={state.companyMode === "group" ? "primary" : "outline"}
                onClick={() => updateField("companyMode", "group")}
              >
                集团公司
              </Button>
            </div>

            {state.companyMode === "group" ? (
              <div className="space-y-4">
                {state.affiliateRoles.map((item, index) => (
                  <div
                    key={`${item.company}-${index}`}
                    className="grid gap-4 border-4 border-ink bg-secondary p-4 shadow-neo-sm md:grid-cols-[1fr_1fr_auto]"
                  >
                    <Input
                      value={item.company}
                      onChange={(event) =>
                        setState((previous) => ({
                          ...previous,
                          affiliateRoles: previous.affiliateRoles.map(
                            (role, currentIndex) =>
                              currentIndex === index
                                ? { ...role, company: event.target.value }
                                : role
                          )
                        }))
                      }
                      placeholder="关联公司名称"
                    />
                    <Input
                      value={item.role}
                      onChange={(event) =>
                        setState((previous) => ({
                          ...previous,
                          affiliateRoles: previous.affiliateRoles.map(
                            (role, currentIndex) =>
                              currentIndex === index
                                ? { ...role, role: event.target.value }
                                : role
                          )
                        }))
                      }
                      placeholder="分工说明"
                    />
                    <Button
                      variant="outline"
                      onClick={() =>
                        setState((previous) => ({
                          ...previous,
                          affiliateRoles: previous.affiliateRoles.filter(
                            (_, currentIndex) => currentIndex !== index
                          )
                        }))
                      }
                    >
                      删除
                    </Button>
                  </div>
                ))}
                <Button
                  variant="secondary"
                  onClick={() =>
                    setState((previous) => ({
                      ...previous,
                      affiliateRoles: [
                        ...previous.affiliateRoles,
                        { company: "", role: "" }
                      ]
                    }))
                  }
                >
                  新增关联公司
                </Button>
              </div>
            ) : (
              <div className="border-4 border-ink bg-secondary p-4 shadow-neo-sm">
                <p className="text-sm font-bold leading-6">
                  当前按独立公司处理，不会写入额外的关联公司列表。
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-paper">
        <CardHeader>
          <Badge variant="accent">审核规则</Badge>
          <CardTitle>维护当前 active_custom_rules</CardTitle>
          <CardDescription>
            这里读取和保存的是与 wizard 同一份自定义规则。保存时会通过
            <code className="mx-1 rounded-none border-2 border-ink bg-secondary px-2 py-1">
              /api/rules/custom
            </code>
            一次性写回。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            value={state.rulesText}
            onChange={(event) => updateField("rulesText", event.target.value)}
            className="min-h-[20rem]"
            placeholder="每行一条审核规则。这里会显示 wizard 生成的规则，也可以继续人工维护。"
          />
        </CardContent>
      </Card>

      {error ? (
        <div className="issue-red p-4">
          <p className="text-sm font-bold leading-6">{error}</p>
        </div>
      ) : null}
      {success ? (
        <div className="issue-blue p-4">
          <p className="flex items-center gap-2 text-sm font-bold leading-6">
            <CheckCircle2 size={18} strokeWidth={3} />
            {success}
          </p>
        </div>
      ) : null}
    </section>
  );
}
