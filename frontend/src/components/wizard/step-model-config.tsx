import {
  AlertCircle,
  Cable,
  CheckCircle2,
  FlaskConical
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
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";

import type {
  WizardConnectionTestResponse,
  WizardProvider
} from "@/components/wizard/types";

type StepModelConfigProps = {
  authenticated: boolean;
  provider: WizardProvider;
  selectedModel: string;
  deepThinkEnabled: boolean;
  openaiApiKey: string;
  deepseekApiKey: string;
  zhipuApiKey: string;
  zhipuOcrApiKey: string;
  testStatus: WizardConnectionTestResponse | null;
  testingProvider: WizardProvider | null;
  onFieldChange: (field: string, value: string | boolean) => void;
  onTestConnection: () => void;
  onNext: () => void;
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
    { label: "DeepSeek Chat", value: "deepseek-chat" },
    { label: "DeepSeek Reasoner", value: "deepseek-reasoner" }
  ],
  zhipuai: [
    { label: "智谱 GLM-4-Flash", value: "glm-4-flash" },
    { label: "智谱 GLM-4V", value: "glm-4v" }
  ]
};

export function StepModelConfig({
  authenticated,
  provider,
  selectedModel,
  deepThinkEnabled,
  openaiApiKey,
  deepseekApiKey,
  zhipuApiKey,
  zhipuOcrApiKey,
  testStatus,
  testingProvider,
  onFieldChange,
  onTestConnection,
  onNext
}: StepModelConfigProps) {
  const currentKey =
    provider === "openai"
      ? openaiApiKey
      : provider === "deepseek"
        ? deepseekApiKey
        : zhipuApiKey;

  return (
    <div className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
      <Card className="bg-paper">
        <CardHeader>
          <Badge variant="accent">步骤 1</Badge>
          <CardTitle>建立当前引导会话</CardTitle>
          <CardDescription>
            你已经通过登录入口进入向导，这里只确认当前会话状态。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {authenticated ? (
            <div className="issue-blue p-4">
              <p className="flex items-center gap-2 text-sm font-bold leading-6">
                <CheckCircle2 size={18} strokeWidth={3} />
                当前已登录，点击下一步开始配置。
              </p>
            </div>
          ) : (
            <div className="issue-red p-4">
              <p className="flex items-center gap-2 text-sm font-bold leading-6">
                <AlertCircle size={18} strokeWidth={3} />
                登录状态未就绪，请返回登录页后再进入向导。
              </p>
            </div>
          )}

          <Button onClick={onNext} disabled={!authenticated}>
            下一步
          </Button>
        </CardContent>
      </Card>

      <Card className="bg-secondary">
        <CardHeader>
          <Badge variant="inverse">模型与密钥</Badge>
          <CardTitle>选择 provider、模型和 API Key</CardTitle>
          <CardDescription>
            这一页的值只暂存在前端 state，最终会在步骤 5 一次性写入
            `settings/profile`。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-bold uppercase tracking-[0.14em]">
                Provider
              </span>
              <Select
                value={provider}
                onChange={(event) =>
                  onFieldChange("provider", event.target.value)
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
                value={selectedModel}
                onChange={(event) =>
                  onFieldChange("selectedModel", event.target.value)
                }
              >
                {providerModels[provider].map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </label>
          </div>

          <label className="space-y-2">
            <span className="text-sm font-bold uppercase tracking-[0.14em]">
              {provider === "openai"
                ? "OpenAI API Key"
                : provider === "deepseek"
                  ? "DeepSeek API Key"
                  : "智谱 API Key"}
            </span>
            <Input
              type="password"
              value={currentKey}
              onChange={(event) =>
                onFieldChange(
                  provider === "openai"
                    ? "openaiApiKey"
                    : provider === "deepseek"
                      ? "deepseekApiKey"
                      : "zhipuApiKey",
                  event.target.value
                )
              }
              placeholder="若后端已有保存密钥，这里可以暂时留空"
            />
          </label>

          {provider === "deepseek" ? (
            <label className="space-y-2">
              <span className="text-sm font-bold uppercase tracking-[0.14em]">
                OCR 补充密钥（智谱 OCR）
              </span>
              <Input
                type="password"
                value={zhipuOcrApiKey}
                onChange={(event) =>
                  onFieldChange("zhipuOcrApiKey", event.target.value)
                }
                placeholder="扫描件场景可以补充智谱 OCR Key"
              />
            </label>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
            <div className="space-y-2">
              <span className="text-sm font-bold uppercase tracking-[0.14em]">
                深度思考
              </span>
              <div className="flex min-h-[3.5rem] items-center justify-between border-4 border-ink bg-paper px-4 shadow-neo-sm">
                <div className="space-y-1">
                  <p className="text-sm font-bold">增强推理模式</p>
                  <p className="text-xs font-bold leading-5">
                    {provider === "zhipuai"
                      ? "智谱当前不支持深度思考，本开关已禁用。"
                      : "OpenAI / DeepSeek 会按后端能力映射到对应模型。"}
                  </p>
                </div>
                <Tooltip
                  content={
                    provider === "zhipuai"
                      ? "智谱不支持深度思考"
                      : "切换深度思考"
                  }
                >
                  <button
                    type="button"
                    disabled={provider === "zhipuai"}
                    onClick={() =>
                      onFieldChange("deepThinkEnabled", !deepThinkEnabled)
                    }
                    className={`inline-flex h-10 min-w-[5.5rem] items-center justify-center border-4 border-ink font-black uppercase tracking-[0.14em] shadow-neo-sm transition-all duration-100 ease-linear ${
                      provider === "zhipuai"
                        ? "cursor-not-allowed bg-paper"
                        : deepThinkEnabled
                          ? "bg-acid"
                          : "bg-muted"
                    }`}
                  >
                    {provider === "zhipuai"
                      ? "禁用"
                      : deepThinkEnabled
                        ? "已开启"
                        : "已关闭"}
                  </button>
                </Tooltip>
              </div>
            </div>
            <Button
              variant="secondary"
              onClick={onTestConnection}
              disabled={!authenticated || testingProvider !== null}
              className="w-full lg:w-auto"
            >
              <Cable size={18} strokeWidth={3} />
              {testingProvider ? "测试中..." : "测试连接"}
            </Button>
          </div>

          {testStatus ? (
            <div
              className={`${testStatus.success ? "issue-blue" : "issue-red"} p-4`}
            >
              <p className="flex items-center gap-2 text-sm font-bold leading-6">
                {testStatus.success ? (
                  <FlaskConical size={18} strokeWidth={3} />
                ) : (
                  <AlertCircle size={18} strokeWidth={3} />
                )}
                {testStatus.message}
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
