import { Bot, FileUp, PencilLine, SendHorizonal, Sparkles } from "lucide-react";
import type { ChangeEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  chatLoading: boolean;
  chatError: string | null;
  canStartAi: boolean;
  onRuleModeChange: (mode: WizardRuleMode) => void;
  onManualRulesChange: (value: string) => void;
  onChatInputChange: (value: string) => void;
  onStartAi: () => void;
  onSendChat: () => void;
  onImportTextFile: (event: ChangeEvent<HTMLInputElement>) => void;
};

export function StepRulesConfig({
  ruleMode,
  manualRulesText,
  chatMessages,
  chatInput,
  generatedRules,
  generatedAffiliates,
  chatLoading,
  chatError,
  canStartAi,
  onRuleModeChange,
  onManualRulesChange,
  onChatInputChange,
  onStartAi,
  onSendChat,
  onImportTextFile
}: StepRulesConfigProps) {
  const aiReady = chatMessages.length > 0;

  return (
    <div className="space-y-6">
      <Card className="bg-paper">
        <CardHeader>
          <Badge variant="accent">步骤 3</Badge>
          <CardTitle>配置审核规则</CardTitle>
          <CardDescription>
            这里保留两条路径。AI 路径和手动路径可以切换，且会尽量互相保留上下文。
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
              <CardTitle>start / chat 最小联调</CardTitle>
              <CardDescription>
                这里会真实调用 `/api/wizard/start` 和 `/api/wizard/chat`。生成结果完成后会展示规则和关联公司。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!aiReady ? (
                <div className="space-y-4 border-4 border-ink bg-paper p-5 shadow-neo-sm">
                  <p className="text-sm font-bold leading-6">
                    你可以先让 AI 参考当前模板、模型配置和已有手写规则作为上下文来发起引导。
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
                      placeholder="例如：我们主要审商业发票和装箱单，最怕数量、收货人和贸易术语出错。"
                    />
                    <div className="flex flex-wrap gap-3">
                      <Button onClick={onSendChat} disabled={chatLoading || !chatInput.trim()}>
                        <SendHorizonal size={18} strokeWidth={3} />
                        {chatLoading ? "发送中..." : "发送给 AI"}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {chatError ? (
                <div className="issue-red p-4">
                  <p className="text-sm font-bold leading-6">{chatError}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="bg-paper">
            <CardHeader>
              <Badge variant="secondary">生成结果</Badge>
              <CardTitle>AI 生成的规则和关联公司</CardTitle>
              <CardDescription>
                当后端返回 `is_complete=true` 时，这里会展示最终结果，并同步保留到手动编辑区。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-3">
                <p className="text-sm font-black uppercase tracking-[0.14em]">规则清单</p>
                <div className="space-y-3">
                  {generatedRules.length > 0 ? (
                    generatedRules.map((rule, index) => (
                      <div key={`${rule}-${index}`} className="border-4 border-ink bg-secondary p-4 shadow-neo-sm">
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
                如果你从 AI 模式切过来，已经生成的规则会自动保留在编辑区，避免内容丢失。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                value={manualRulesText}
                onChange={(event) => onManualRulesChange(event.target.value)}
                className="min-h-[20rem]"
                placeholder="每行一条规则，例如：&#10;发票抬头必须与 PO 一致&#10;合同号和 Invoice No. 不允许混用"
              />
              <label className="inline-flex cursor-pointer items-center gap-3 border-4 border-ink bg-secondary px-4 py-3 font-bold uppercase tracking-[0.14em] shadow-neo-sm transition-all duration-100 ease-linear hover:-translate-y-0.5">
                <FileUp size={18} strokeWidth={3} />
                导入 .txt
                <input type="file" accept=".txt,text/plain" className="hidden" onChange={onImportTextFile} />
              </label>
            </CardContent>
          </Card>

          <Card className="bg-muted">
            <CardHeader>
              <Badge variant="inverse">路径切换说明</Badge>
              <CardTitle>路径 A / B 可以来回切换</CardTitle>
              <CardDescription>
                手动模式写的内容会作为 AI 启动上下文，AI 生成的结果也会回填到手动编辑器。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
                <p className="text-sm font-bold leading-6">
                  当前手动规则条数：{manualRulesText.split("\n").filter((line) => line.trim()).length}
                </p>
              </div>
              <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
                <p className="text-sm font-bold leading-6">
                  如果后续切回 AI 模式，我会把这些手写规则作为“已有草稿”传给 `/api/wizard/start`。
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
