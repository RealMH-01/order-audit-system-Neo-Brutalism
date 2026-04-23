import { AlertCircle, Loader2, RefreshCcw, Save, ShieldCheck, ShieldOff } from "lucide-react";

import type { BuiltinRuleFull, BuiltinRulePublic, RulesRole } from "@/components/rules/types";
import { formatRulesDate } from "@/components/rules/rules-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

type BuiltinRulesPanelProps = {
  role: RulesRole | null;
  loading: boolean;
  error: string | null;
  publicRule: BuiltinRulePublic | null;
  fullRule: BuiltinRuleFull | null;
  displayText: string;
  promptText: string;
  saving: boolean;
  onDisplayTextChange: (value: string) => void;
  onPromptTextChange: (value: string) => void;
  onSave: () => void;
  onReset: () => void;
  onRetry: () => void;
};

export function BuiltinRulesPanel({
  role,
  loading,
  error,
  publicRule,
  fullRule,
  displayText,
  promptText,
  saving,
  onDisplayTextChange,
  onPromptTextChange,
  onSave,
  onReset,
  onRetry
}: BuiltinRulesPanelProps) {
  const isAdmin = role === "admin";
  const activeRule = isAdmin && fullRule ? fullRule : publicRule;

  return (
    <Card className="bg-paper">
      <CardHeader>
        <Badge variant="accent">系统规则</Badge>
        <CardTitle>通用 built-in 规则</CardTitle>
        <CardDescription>
          当前页面会按真实权限边界读取 `/api/rules/builtin` 和 `/api/rules/builtin/full`。所有已登录用户可查看通用规则，只有管理员可保存修改。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="border-4 border-ink bg-canvas p-4 shadow-neo-sm">
            <p className="flex items-center gap-2 text-sm font-bold leading-6">
              <Loader2 className="animate-spin" size={18} strokeWidth={3} />
              正在加载系统规则...
            </p>
          </div>
        ) : error ? (
          <div className="space-y-4">
            <div className="issue-red p-4">
              <p className="flex items-center gap-2 text-sm font-bold leading-6">
                <AlertCircle size={18} strokeWidth={3} />
                {error}
              </p>
            </div>
            <Button variant="outline" onClick={onRetry}>
              <RefreshCcw size={18} strokeWidth={3} />
              重新读取系统规则
            </Button>
          </div>
        ) : activeRule ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="inverse">{activeRule.key}</Badge>
              <Badge variant={isAdmin ? "secondary" : "muted"}>
                {isAdmin ? (
                  <>
                    <ShieldCheck size={12} strokeWidth={3} />
                    管理员可编辑
                  </>
                ) : (
                  <>
                    <ShieldOff size={12} strokeWidth={3} />
                    当前为只读查看
                  </>
                )}
              </Badge>
              <Badge variant="neutral">最近更新：{formatRulesDate(activeRule.updated_at)}</Badge>
            </div>

            <label className="space-y-2">
              <span className="text-sm font-black uppercase tracking-[0.14em]">
                对外展示规则
              </span>
              <Textarea
                value={displayText}
                onChange={(event) => onDisplayTextChange(event.target.value)}
                disabled={!isAdmin}
                className="min-h-[14rem]"
              />
            </label>

            {isAdmin ? (
              <label className="space-y-2">
                <span className="text-sm font-black uppercase tracking-[0.14em]">
                  Prompt 规则全文
                </span>
                <Textarea
                  value={promptText}
                  onChange={(event) => onPromptTextChange(event.target.value)}
                  disabled={!isAdmin}
                  className="min-h-[18rem]"
                />
              </label>
            ) : (
              <div className="border-4 border-ink bg-secondary p-4 shadow-neo-sm">
                <p className="text-sm font-bold leading-6">
                  当前账号不是管理员，因此这里只展示通用规则摘要，不开放 prompt 全文编辑。
                </p>
              </div>
            )}

            {isAdmin ? (
              <div className="flex flex-wrap gap-3">
                <Button onClick={onSave} disabled={saving}>
                  {saving ? (
                    <Loader2 className="animate-spin" size={18} strokeWidth={3} />
                  ) : (
                    <Save size={18} strokeWidth={3} />
                  )}
                  {saving ? "保存中..." : "保存系统规则"}
                </Button>
                <Button variant="outline" onClick={onReset} disabled={saving}>
                  重置编辑内容
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <div className="issue-yellow p-4">
            <p className="text-sm font-bold leading-6">
              当前还没有读取到系统规则内容，请稍后重试。
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

