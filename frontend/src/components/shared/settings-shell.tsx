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
import { normalizeApiErrorDetail } from "@/lib/api-error";
import { useAuth } from "@/lib/auth-context";
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
    { label: "智谱 GLM-4.6V", value: "glm-4.6v" },
    { label: "智谱 GLM-4.6V-Flash", value: "glm-4.6v-flash" }
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

const ZHIPU_LEGACY_MODEL_MAP: Record<string, string> = {
  "glm-4v": "glm-4.6v",
  "glm-4-flash": "glm-4.6v-flash"
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

export function SettingsShell() {
  const router = useRouter();
  const { state: authState, updateCurrentUser } = useAuth();
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
  const accountEmail = authState.user?.email ?? "当前登录邮箱";

  const currentHasKey = useMemo(() => {
    if (state.provider === "openai") {
      return state.hasOpenaiKey;
    }
    if (state.provider === "deepseek") {
      return state.hasDeepseekKey;
    }
    return state.hasZhipuKey;
  }, [state.hasDeepseekKey, state.hasOpenaiKey, state.hasZhipuKey, state.provider]);

  const currentProviderName =
    state.provider === "openai"
      ? "OpenAI"
      : state.provider === "deepseek"
        ? "DeepSeek"
        : "智谱 GLM";
  const currentKeyField =
    state.provider === "openai"
      ? "openaiApiKey"
      : state.provider === "deepseek"
        ? "deepseekApiKey"
        : "zhipuApiKey";
  const currentKeyValue = state[currentKeyField];
  const currentCapabilityText =
    state.provider === "openai"
      ? "OpenAI 模型适合通用审核、规则理解与稳定输出，可作为默认审核主模型。"
      : state.provider === "deepseek"
        ? "DeepSeek 模型适合复杂文本推理与性价比场景，可配合 OCR 补充密钥处理扫描件。"
        : "智谱 GLM 模型适合多模态与视觉理解场景，GLM-4.6V 支持深度思考模式。";

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
        deepThinkEnabled: data.deep_think_enabled,
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
        wizardCompleted: data.wizard_completed,
        disclaimerAccepted: data.disclaimer_accepted
      });
    } catch (loadError) {
      setError(
        normalizeApiErrorDetail(loadError, "读取当前设置失败，请稍后重试。")
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
                : "glm-4.6v";
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
              model: state.selectedModel,
              use_saved_key: !state.openaiApiKey.trim(),
              api_key: state.openaiApiKey.trim() || null
            }
          : state.provider === "deepseek"
            ? {
                provider: "deepseek",
                model: state.selectedModel,
                use_saved_key: !state.deepseekApiKey.trim(),
                api_key: state.deepseekApiKey.trim() || null
              }
            : {
                provider: "zhipuai",
                model: state.selectedModel,
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
        message: normalizeApiErrorDetail(testError, "连接测试失败，请稍后再试。")
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
          deep_think_enabled: state.deepThinkEnabled,
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

      updateCurrentUser({ display_name: state.displayName.trim() || null });
      setSuccess("配置已保存，后续审核会自动使用这套模型、密钥和公司信息。");
      await loadProfile(token);
    } catch (saveError) {
      setError(
        normalizeApiErrorDetail(saveError, "保存设置失败，请稍后重试。")
      );
    } finally {
      setSaving(false);
    }
  }, [loadProfile, state, token, updateCurrentUser]);

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
            <Badge variant="accent">配置中心</Badge>
            <CardTitle>请先进入向导或完成登录</CardTitle>
            <CardDescription>
              当前页面需要登录后使用。你可以先进入引导向导，完成基础配置后再回来维护审核配置。
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
      <Card className="bg-acid p-4 md:p-5">
        <CardHeader className="mb-0 gap-4 md:flex md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <Badge variant="inverse" className="rotate-[-2deg]">
              配置中心
            </Badge>
            <div className="space-y-2">
              <CardTitle>统一维护模型、密钥与审核规则</CardTitle>
              <CardDescription>
                在这里配置审核使用的模型、密钥、公司信息与自定义规则。
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

      <Card className="bg-secondary">
        <CardHeader className="md:flex md:flex-row md:items-start md:justify-between md:gap-6">
          <div className="space-y-2">
            <Badge variant="inverse">核心配置</Badge>
            <CardTitle>模型与密钥配置</CardTitle>
            <CardDescription>
              选择审核主模型，填写该模型密钥，并在同一处完成连接测试与保存。
            </CardDescription>
          </div>
          <Badge variant={currentHasKey ? "secondary" : "neutral"}>
            {currentProviderName} {currentHasKey ? "已保存密钥" : "未保存密钥"}
          </Badge>
        </CardHeader>
        <CardContent className="grid items-stretch gap-5 xl:grid-cols-2">
          <div className="flex min-h-[28rem] flex-col justify-between border-4 border-ink bg-paper p-4 shadow-neo-sm">
            <div className="space-y-4">
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
                        ? "GLM-4.6V 支持深度思考。开启后，系统会在智谱请求中启用更强的推理模式。"
                        : "开启后，系统会在支持的模型上使用更强的推理能力进行审核。"}
                    </p>
                  </div>
                  <Button
                    variant={state.deepThinkEnabled ? "primary" : "outline"}
                    onClick={() =>
                      updateField("deepThinkEnabled", !state.deepThinkEnabled)
                    }
                  >
                    {state.deepThinkEnabled ? "已开启" : "已关闭"}
                  </Button>
                </div>
              </div>
            </div>

            <div className="mt-4 border-4 border-ink bg-acid p-4 shadow-neo-sm">
              <p className="text-xs font-black uppercase tracking-[0.14em]">
                当前模型能力说明
              </p>
              <p className="mt-2 text-sm font-bold leading-6">
                {currentCapabilityText}
              </p>
            </div>
          </div>

          <div className="flex min-h-[28rem] flex-col justify-between border-4 border-ink bg-acid p-4 shadow-neo-sm">
            <div className="space-y-4">
              <div className="flex flex-wrap gap-3">
                <Badge variant={currentHasKey ? "secondary" : "neutral"}>
                  {currentProviderName} {currentHasKey ? "已保存" : "未保存"}
                </Badge>
                <Badge variant={state.hasZhipuOcrKey ? "secondary" : "neutral"}>
                  智谱 OCR {state.hasZhipuOcrKey ? "已保存" : "未保存"}
                </Badge>
              </div>

              <label className="space-y-2">
                <span className="text-sm font-bold uppercase tracking-[0.14em]">
                  {currentProviderName} 密钥
                </span>
                <Input
                  type="password"
                  value={currentKeyValue}
                  onChange={(event) =>
                    updateField(currentKeyField, event.target.value)
                  }
                  placeholder={
                    currentHasKey
                      ? "已有保存密钥，如需更新可直接输入新的值"
                      : `请输入 ${currentProviderName} 密钥`
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
                      : "如需给扫描件 OCR 补充模型，可在这里填写"
                  }
                />
                <span className="block text-xs font-black leading-5">
                  仅在扫描件 OCR 需要补充模型时使用，不等同于当前审核主模型密钥。
                </span>
              </label>

              <Button
                variant="secondary"
                onClick={handleTestConnection}
                disabled={testingProvider !== null}
              >
                <Cable size={18} strokeWidth={3} />
                {testingProvider ? "测试中..." : "测试当前模型连接"}
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
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <Button onClick={handleSave} disabled={saving}>
                <Save size={18} strokeWidth={3} />
                {saving ? "保存中..." : "保存模型与密钥配置"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid items-stretch gap-6 xl:grid-cols-2">
        <Card className="bg-paper">
          <CardHeader>
            <Badge variant="secondary">账号资料</Badge>
            <CardTitle>当前登录账号</CardTitle>
            <CardDescription>
              账号昵称仅用于区分当前账号，不影响模型调用、审核规则或密钥。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="border-4 border-ink bg-secondary p-4 shadow-neo-sm">
              <p className="text-xs font-black uppercase tracking-[0.14em]">
                登录邮箱
              </p>
              <p className="mt-2 break-words text-sm font-bold leading-6">
                {accountEmail}
              </p>
            </div>
            <label className="space-y-2">
              <span className="text-sm font-bold uppercase tracking-[0.14em]">
                账号昵称
              </span>
              <Input
                value={state.displayName}
                onChange={(event) => updateField("displayName", event.target.value)}
                placeholder="例如：订单审核组 / 张三 / 业务审核账号"
              />
            </label>
          </CardContent>
        </Card>

        <Card className="bg-muted">
          <CardHeader>
            <Badge variant="inverse">引导状态</Badge>
            <CardTitle>当前引导完成情况</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
                <p className="text-xs font-black uppercase tracking-[0.14em]">
                  引导状态
                </p>
                <p className="mt-2 text-sm font-bold leading-6">
                  {state.wizardCompleted ? "当前可用" : "未完成"}
                </p>
              </div>
              <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
                <p className="text-xs font-black uppercase tracking-[0.14em]">
                  使用须知状态
                </p>
                <p className="mt-2 text-sm font-bold leading-6">
                  {state.disclaimerAccepted ? "已确认" : "尚未确认"}
                </p>
              </div>
            </div>
            <div className="issue-blue p-4">
              <p className="text-sm font-bold leading-6">
                你可以直接进入审核工作台；如果此前跳过了引导，也可以随时重新运行引导补充配置。
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-paper">
        <CardHeader>
          <Badge variant="muted">公司信息</Badge>
          <CardTitle>维护审核使用的公司信息</CardTitle>
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

      <Card className="bg-paper">
        <CardHeader>
          <Badge variant="accent">自定义规则集</Badge>
          <CardTitle>自定义规则集管理</CardTitle>
          <CardDescription>
            多套自定义规则集请在「自定义规则集」页面创建和维护。审核时选择其中一套使用。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="secondary" onClick={() => router.push("/templates")}>
            <ArrowRight size={18} strokeWidth={3} />
            前往自定义规则集页面
          </Button>
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
