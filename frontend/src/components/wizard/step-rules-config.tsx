import { Bot, FileUp, PencilLine, RotateCcw, SendHorizonal, Sparkles } from "lucide-react";
import type { ChangeEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";

import type { WizardMessage, WizardRuleMode } from "@/components/wizard/types";

type StepRulesConfigProps = {
  ruleMode: WizardRuleMode;
  manualRulesText: string;
  chatMessages: WizardMessage[];
  chatInput: string;
  generatedRules: string[];
  generatedAffiliates: string[];
  aiCompleted: boolean;
  aiRulesConfirmed: boolean;
  chatLoading: boolean;
  chatError: string | null;
  rulesImportError: string | null;
  canStartAi: boolean;
  onRuleModeChange: (mode: WizardRuleMode) => void;
  onManualRulesChange: (value: string) => void;
  onChatInputChange: (value: string) => void;
  onStartAi: () => void;
  onSendChat: () => void;
  onSummarizeNow: () => void;
  onRetryAi: () => void;
  onSwitchToManual: () => void;
  onConfirmAiRules: () => void;
  onImportTextFile: (event: ChangeEvent<HTMLInputElement>) => void;
};

export function StepRulesConfig({
  ruleMode,
  manualRulesText,
  chatMessages,
  chatInput,
  generatedRules,
  generatedAffiliates,
  aiCompleted,
  aiRulesConfirmed,
  chatLoading,
  chatError,
  rulesImportError,
  canStartAi,
  onRuleModeChange,
  onManualRulesChange,
  onChatInputChange,
  onStartAi,
  onSendChat,
  onSummarizeNow,
  onRetryAi,
  onSwitchToManual,
  onConfirmAiRules,
  onImportTextFile
}: StepRulesConfigProps) {
  const aiReady = chatMessages.length > 0;
  const showSummarizeButton = chatMessages.length >= 6 && !aiCompleted;

  return (
    <div className="space-y-6">
      <Card className="bg-paper">
        <CardHeader>
          <Badge variant="accent">步骤 3</Badge>
          <CardTitle>配置审核规则</CardTitle>
          <CardDescription>
            这里支持两条路径。AI 生成的内容会尽量回填到手动编辑器，手写内容也会作为 AI 上下文继续使用。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button
            variant={ruleMode === "ai" ? "primary" : "outline"}
            onClick={() => onRuleModeChange("ai")}
          >
            <Bot size={18} strokeWidth={3} />
            路径 A：让 AI 帮我配置
          </Button>
          <Button
            variant={ruleMode === "manual" ? "primary" : "outline"}
            onClick={() => onRuleModeChange("manual")}
          >
            <PencilLine size={18} strokeWidth={3} />
            路径 B：我自己来写
          </Button>
        </CardContent>
      </Card>

      {ruleMode === "ai" ? (
        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <Card className="bg-muted">
            <CardHeader>
              <Badge variant="inverse">AI 引导对话</Badge>
              <CardTitle>让 AI 帮你梳理规则</CardTitle>
              <CardDescription>
                AI 会根据业务背景、模型配置和你的规则草稿继续追问。信息足够后，可以让它直接总结。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!aiReady ? (
                <div className="space-y-4 border-4 border-ink bg-paper p-5 shadow-neo-sm">
                  <p className="text-sm font-bold leading-6">
                    AI 会参考业务背景、模型配置和现有手写规则草稿，逐步帮你整理审核规则。
                  </p>
                  <Button onClick={onStartAi} disabled={!canStartAi || chatLoading}>
                    <Sparkles size={18} strokeWidth={3} />
                    {chatLoading ? "启动中..." : "开始 AI 引导"}
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <ScrollArea className="max-h-[28rem] bg-paper">
                    <div className="space-y-4">
                      {chatMessages.map((message, index) => (
                        <div
                          key={`${message.role}-${index}`}
                          className={`border-4 border-ink p-4 shadow-neo-sm ${
                            message.role === "assistant" ? "bg-secondary" : "bg-paper"
                          }`}
                        >
                          <p className="mb-2 text-xs font-black uppercase tracking-[0.18em]">
                            {message.role === "assistant" ? "AI 向导" : "你"}
                          </p>
                          <p className="whitespace-pre-line text-sm font-bold leading-6">
                            {message.content}
                          </p>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>

                  <div className="space-y-3">
                    <Textarea
                      value={chatInput}
                      onChange={(event) => onChatInputChange(event.target.value)}
                      placeholder="例如：我们主要审订单、发票和交付资料，最怕数量、金额和交付日期出错。"
                    />
                    <div className="flex flex-wrap gap-3">
                      <Button onClick={onSendChat} disabled={chatLoading || !chatInput.trim()}>
                        <SendHorizonal size={18} strokeWidth={3} />
                        {chatLoading ? "发送中..." : "发送给 AI"}
                      </Button>
                      {showSummarizeButton ? (
                        <Button variant="secondary" onClick={onSummarizeNow} disabled={chatLoading}>
                          现在就总结
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              )}

              {chatError ? (
                <div className="issue-red p-4">
                  <p className="text-sm font-bold leading-6">{chatError}</p>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <Button variant="secondary" onClick={onRetryAi} disabled={chatLoading}>
                      <RotateCcw size={18} strokeWidth={3} />
                      重试
                    </Button>
                    <Button variant="outline" onClick={onSwitchToManual}>
                      切换到手动模式
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="bg-paper">
            <CardHeader>
              <Badge variant="secondary">生成结果</Badge>
              <CardTitle>AI 生成的规则和关联公司</CardTitle>
              <CardDescription>
                只有当 AI 完成且你确认采用这些规则后，步骤 3 才允许进入下一步。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-3">
                <p className="text-sm font-black uppercase tracking-[0.14em]">规则清单</p>
                <div className="space-y-3">
                  {generatedRules.length > 0 ? (
                    generatedRules.map((rule, index) => (
                      <div
                        key={`${rule}-${index}`}
                        className="border-4 border-ink bg-secondary p-4 shadow-neo-sm"
                      >
                        <p className="text-sm font-bold leading-6">{rule}</p>
                      </div>
                    ))
                  ) : (
                    <div className="border-4 border-ink bg-canvas p-4 shadow-neo-sm">
                      <p className="text-sm font-bold leading-6">
                        AI 还没有输出最终规则。你也可以切到手动模式继续编辑。
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-sm font-black uppercase tracking-[0.14em]">关联公司</p>
                <div className="flex flex-wrap gap-3">
                  {generatedAffiliates.length > 0 ? (
                    generatedAffiliates.map((item) => (
                      <Badge key={item} variant="muted">
                        {item}
                      </Badge>
                    ))
                  ) : (
                    <Badge variant="neutral">暂未生成</Badge>
                  )}
                </div>
              </div>

              <div
                className={`${aiCompleted ? "issue-blue" : "issue-yellow"} p-4`}
              >
                <p className="text-sm font-bold leading-6">
                  {aiCompleted
                    ? aiRulesConfirmed
                      ? "你已经确认采用当前 AI 生成规则，可以进入下一步。"
                      : "AI 已完成总结，请先确认采用这些规则。"
                    : "AI 还没有完成总结，当前不能按 AI 路径进入下一步。"}
                </p>
              </div>

              <Button
                variant={aiRulesConfirmed ? "secondary" : "primary"}
                onClick={onConfirmAiRules}
                disabled={!aiCompleted || generatedRules.length === 0}
              >
                {aiRulesConfirmed ? "已确认采用这些规则" : "确认采用这些规则"}
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <Card className="bg-paper">
            <CardHeader>
              <Badge variant="muted">手动配置</Badge>
              <CardTitle>自己写规则或导入文本</CardTitle>
              <CardDescription>
                手动路径允许规则为空；如果你后续切回 AI 路径，这些内容也会作为继续引导的上下文。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                value={manualRulesText}
                onChange={(event) => onManualRulesChange(event.target.value)}
                className="min-h-[20rem]"
                placeholder={"每行一条规则，例如：\n发票抬头必须与 PO 一致\n合同号和 Invoice No. 不允许混用"}
              />
              <label className="inline-flex cursor-pointer items-center gap-3 border-4 border-ink bg-secondary px-4 py-3 font-bold uppercase tracking-[0.14em] shadow-neo-sm transition-all duration-100 ease-linear hover:-translate-y-0.5">
                <FileUp size={18} strokeWidth={3} />
                导入 .txt
                <input
                  type="file"
                  accept=".txt,text/plain"
                  className="hidden"
                  onChange={onImportTextFile}
                />
              </label>
              <div className="border-2 border-ink bg-sky px-3 py-2 text-xs font-black leading-5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                支持格式：UTF-8 .txt 文本；单文件 20MB 以内；每次导入 1 个文件，导入后会覆盖当前手写规则草稿。
              </div>
              {rulesImportError ? (
                <div className="issue-red p-4">
                  <p className="text-sm font-bold leading-6">{rulesImportError}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="bg-muted">
            <CardHeader>
              <Badge variant="inverse">路径切换说明</Badge>
              <CardTitle>路径 A / B 可以来回切换</CardTitle>
              <CardDescription>
                手写内容会继续喂给 AI，AI 生成结果也会回填到手动编辑器，尽量避免内容丢失。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
                <p className="text-sm font-bold leading-6">
                  当前手动规则条数：
                  {manualRulesText.split("\n").filter((line) => line.trim()).length}
                </p>
              </div>
              <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
                <p className="text-sm font-bold leading-6">
                  如果你稍后切回 AI 模式，我会把这些手写规则作为已有草稿继续整理。
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
