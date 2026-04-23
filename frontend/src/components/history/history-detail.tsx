import { ArrowRight, FileText, RefreshCcw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

import type { HistoryDetailRecord, HistoryIssue } from "@/components/history/types";

type HistoryDetailProps = {
  item: HistoryDetailRecord | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onGoAudit: () => void;
};

function formatDate(value: string | null) {
  if (!value) {
    return "后端未返回时间";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "时间格式不可用";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function resolveIssueClass(level: string | undefined) {
  if (level === "RED") {
    return "issue-red";
  }
  if (level === "BLUE") {
    return "issue-blue";
  }
  return "issue-yellow";
}

function resolveIssueMessage(issue: HistoryIssue) {
  return issue.finding || issue.message || "后端当前未返回更详细的问题说明。";
}

function resolveIssueSuggestion(issue: HistoryIssue) {
  return issue.suggestion || "后端当前未返回修正建议。";
}

function resolveConfidence(issue: HistoryIssue) {
  if (typeof issue.confidence !== "number") {
    return "后端未返回置信度";
  }

  return `置信度 ${Math.round(issue.confidence * 100)}%`;
}

export function HistoryDetail({
  item,
  loading,
  error,
  onRetry,
  onGoAudit
}: HistoryDetailProps) {
  const issues = item?.audit_result?.issues ?? [];

  return (
    <Card className="bg-muted">
      <CardHeader>
        <Badge variant="inverse">详情区</Badge>
        <CardTitle>审核详情回看</CardTitle>
        <CardDescription>
          这里会按后端当前真实详情结构展示基础信息、审核摘要与问题明细。如果后端只返回最小结构，也会明确说明。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
            <p className="text-sm font-bold leading-6">正在加载历史详情...</p>
          </div>
        ) : error ? (
          <div className="space-y-4">
            <div className="issue-red p-4">
              <p className="text-sm font-bold leading-6">{error}</p>
            </div>
            <Button variant="outline" onClick={onRetry}>
              <RefreshCcw size={18} strokeWidth={3} />
              重试读取详情
            </Button>
          </div>
        ) : item ? (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
                <p className="text-xs font-black uppercase tracking-[0.14em]">记录标识</p>
                <p className="mt-2 text-sm font-bold leading-6">
                  {item.id ? `审核记录 ${String(item.id).slice(0, 8)}` : "后端未返回记录标识"}
                </p>
              </div>
              <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
                <p className="text-xs font-black uppercase tracking-[0.14em]">模型</p>
                <p className="mt-2 text-sm font-bold leading-6">{item.model_used}</p>
              </div>
              <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
                <p className="text-xs font-black uppercase tracking-[0.14em]">创建时间</p>
                <p className="mt-2 text-sm font-bold leading-6">{formatDate(item.created_at)}</p>
              </div>
              <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
                <p className="text-xs font-black uppercase tracking-[0.14em]">更新时间</p>
                <p className="mt-2 text-sm font-bold leading-6">{formatDate(item.updated_at)}</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <div className="issue-red p-4">
                <p className="text-xs font-black uppercase tracking-[0.14em]">RED</p>
                <p className="mt-2 text-3xl font-black leading-none">{item.red_count}</p>
              </div>
              <div className="issue-yellow p-4">
                <p className="text-xs font-black uppercase tracking-[0.14em]">YELLOW</p>
                <p className="mt-2 text-3xl font-black leading-none">{item.yellow_count}</p>
              </div>
              <div className="issue-blue p-4">
                <p className="text-xs font-black uppercase tracking-[0.14em]">BLUE</p>
                <p className="mt-2 text-3xl font-black leading-none">{item.blue_count}</p>
              </div>
              <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
                <p className="text-xs font-black uppercase tracking-[0.14em]">文件数</p>
                <p className="mt-2 text-3xl font-black leading-none">{item.document_count}</p>
              </div>
            </div>

            <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">已完成</Badge>
                <Badge variant="muted">
                  {item.deep_think_used ? "本次使用深度思考" : "本次未使用深度思考"}
                </Badge>
                <Badge variant="neutral">自定义规则快照 {item.custom_rules_snapshot.length} 条</Badge>
              </div>
              <p className="mt-3 text-sm font-bold leading-6">
                {item.audit_result?.message || "后端当前仅返回最小详情结构，未提供额外摘要说明。"}
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-black uppercase tracking-tight">问题明细</h3>
                <Badge variant="accent">{issues.length} 条</Badge>
              </div>
              <ScrollArea className="max-h-[28rem] bg-paper">
                <div className="space-y-3">
                  {issues.length > 0 ? (
                    issues.map((issue, index) => (
                      <div
                        key={`${issue.field_name ?? "field"}-${index}`}
                        className={`${resolveIssueClass(issue.level)} p-4`}
                      >
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="inverse">{issue.level ?? "YELLOW"}</Badge>
                          <Badge variant="neutral">
                            {issue.field_name || "后端未返回字段名"}
                          </Badge>
                          <Badge variant="muted">
                            {issue.document_label || issue.document_type || "后端未返回文档归属"}
                          </Badge>
                        </div>
                        <p className="mt-3 text-sm font-bold leading-6">
                          {resolveIssueMessage(issue)}
                        </p>
                        <p className="mt-2 text-sm font-bold leading-6">
                          {resolveIssueSuggestion(issue)}
                        </p>
                        <p className="mt-2 text-xs font-black uppercase tracking-[0.14em]">
                          {resolveConfidence(issue)}
                        </p>
                      </div>
                    ))
                  ) : (
                    <div className="issue-blue p-4">
                      <p className="text-sm font-bold leading-6">
                        当前后端详情里没有返回问题列表，或这条记录没有问题明细。
                      </p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>

            <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
              <div className="flex items-center gap-2">
                <FileText size={18} strokeWidth={3} />
                <p className="text-sm font-black uppercase tracking-[0.14em]">报告信息</p>
              </div>
              <p className="mt-3 text-sm font-bold leading-6">
                当前历史详情接口还没有返回独立报告下载信息。本页会诚实展示这一点，不假装已有完整报告能力。
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button onClick={onGoAudit}>
                <ArrowRight size={18} strokeWidth={3} />
                返回审核工作台
              </Button>
            </div>
          </>
        ) : (
          <div className="issue-yellow p-4">
            <p className="text-sm font-bold leading-6">
              请选择左侧一条历史记录，查看本次审核的详情回看。
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
