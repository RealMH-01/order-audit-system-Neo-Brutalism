import { ArrowLeftRight, CheckCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import type { WizardAffiliateRole, WizardProvider, WizardRuleMode, WizardTemplateOption } from "@/components/wizard/types";

type StepConfirmProps = {
  provider: WizardProvider;
  selectedModel: string;
  deepThinkEnabled: boolean;
  selectedTemplate: WizardTemplateOption;
  ruleMode: WizardRuleMode;
  finalRules: string[];
  companyMode: "single" | "group";
  affiliateRoles: WizardAffiliateRole[];
  saving: boolean;
  completeError: string | null;
  completeMessage: string | null;
  onJumpToStep: (index: number) => void;
  onSubmit: () => void;
};

export function StepConfirm({
  provider,
  selectedModel,
  deepThinkEnabled,
  selectedTemplate,
  ruleMode,
  finalRules,
  companyMode,
  affiliateRoles,
  saving,
  completeError,
  completeMessage,
  onJumpToStep,
  onSubmit
}: StepConfirmProps) {
  return (
    <div className="space-y-6">
      <Card className="bg-paper">
        <CardHeader>
          <Badge variant="accent">步骤 5</Badge>
          <CardTitle>确认总结</CardTitle>
          <CardDescription>
            最后一步会汇总模型配置、模板选择、审核规则和公司架构，并调用 `/api/wizard/complete` 或 `/api/wizard/skip`。
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="bg-secondary">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="space-y-2">
              <Badge variant="inverse">模型配置</Badge>
              <CardTitle>{provider.toUpperCase()}</CardTitle>
              <CardDescription>当前选择的 provider、模型和深度思考状态。</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => onJumpToStep(0)}>
              <ArrowLeftRight size={18} strokeWidth={3} />
              修改
            </Button>
          </CardHeader>
          <CardContent className="space-y-3 text-sm font-bold leading-6">
            <p>模型：{selectedModel}</p>
            <p>深度思考：{deepThinkEnabled ? "已开启" : "未开启"}</p>
          </CardContent>
        </Card>

        <Card className="bg-paper">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="space-y-2">
              <Badge variant="secondary">行业模板</Badge>
              <CardTitle>{selectedTemplate.label}</CardTitle>
              <CardDescription>{selectedTemplate.description}</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => onJumpToStep(1)}>
              <ArrowLeftRight size={18} strokeWidth={3} />
              修改
            </Button>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-line text-sm font-bold leading-6">
              {selectedTemplate.rulesText || "当前没有预置模板规则。"}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-muted">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="space-y-2">
              <Badge variant="accent">审核规则</Badge>
              <CardTitle>{ruleMode === "ai" ? "AI 引导生成" : "手动编写"}</CardTitle>
              <CardDescription>最终将写回到当前用户的 `active_custom_rules`。</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => onJumpToStep(2)}>
              <ArrowLeftRight size={18} strokeWidth={3} />
              修改
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {finalRules.length > 0 ? (
              finalRules.map((rule, index) => (
                <div key={`${rule}-${index}`} className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
                  <p className="text-sm font-bold leading-6">{rule}</p>
                </div>
              ))
            ) : (
              <div className="issue-red p-4">
                <p className="text-sm font-bold leading-6">当前还没有可提交的审核规则。</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-paper">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="space-y-2">
              <Badge variant="muted">公司架构</Badge>
              <CardTitle>{companyMode === "single" ? "独立公司" : "集团公司"}</CardTitle>
              <CardDescription>最终会写回 `company_affiliates` 和 `company_affiliates_roles`。</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => onJumpToStep(3)}>
              <ArrowLeftRight size={18} strokeWidth={3} />
              修改
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {companyMode === "single" ? (
              <p className="text-sm font-bold leading-6">当前按单主体公司处理。</p>
            ) : affiliateRoles.length > 0 ? (
              affiliateRoles.map((item, index) => (
                <div key={`${item.company}-${index}`} className="border-4 border-ink bg-secondary p-4 shadow-neo-sm">
                  <p className="text-sm font-bold leading-6">{item.company || `关联公司 ${index + 1}`}</p>
                  <p className="mt-2 text-sm font-bold leading-6">{item.role || "未填写分工说明"}</p>
                </div>
              ))
            ) : (
              <p className="text-sm font-bold leading-6">集团模式下还没有填写关联主体。</p>
            )}
          </CardContent>
        </Card>
      </div>

      {completeError ? (
        <div className="issue-red p-4">
          <p className="text-sm font-bold leading-6">{completeError}</p>
        </div>
      ) : null}
      {completeMessage ? (
        <div className="issue-blue p-4">
          <p className="text-sm font-bold leading-6">{completeMessage}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap justify-end gap-3">
        <Button onClick={onSubmit} disabled={saving || finalRules.length === 0}>
          <CheckCheck size={18} strokeWidth={3} />
          {saving ? "提交中..." : "完成设置"}
        </Button>
      </div>
    </div>
  );
}
