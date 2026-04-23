import { AlertCircle, ArrowRight, ChevronDown, FileText, RefreshCcw } from "lucide-react";

import {
  formatHistoryDate,
  formatHistoryTitle,
  resolveHistoryStatus,
  resolveHistoryStatusLabel,
  summarizeSeverity
} from "@/components/history/history-utils";
import type {
  HistoryDetailRecord,
  HistoryDocumentResult,
  HistoryIssue
} from "@/components/history/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

type HistoryDetailProps = {
  item: HistoryDetailRecord | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onGoAudit: () => void;
};

function resolveIssueClass(level: HistoryIssue["level"]) {
  if (level === "RED") {
    return "issue-red";
  }
  if (level === "BLUE") {
    return "issue-blue";
  }
  return "issue-yellow";
}

function resolveIssueMessage(issue: HistoryIssue) {
  return issue.finding || issue.message || "当前后端未返回更详细的问题说明。";
}

function resolveIssueSuggestion(issue: HistoryIssue) {
  return issue.suggestion || "当前后端未返回修正建议。";
}

function resolveConfidence(confidence?: number) {
  if (typeof confidence !== "number") {
    return "后端未返回置信度";
  }

  return `置信度 ${Math.round(confidence * 100)}%`;
}

function resolveDocumentCount(document: HistoryDocumentResult) {
  return document.result?.issues?.length ?? 0;
}

function IssueCard({ issue, index }: { issue: HistoryIssue; index: number }) {
  return (
    <details className={`${resolveIssueClass(issue.level)} group p-4`} open={index < 2}>
      <summary className="flex cursor-pointer list-none flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Badge variant="inverse">{issue.level ?? "YELLOW"}</Badge>
            <Badge variant="neutral">{issue.field_name || "未返回字段名"}</Badge>
            <Badge variant="muted">
              {issue.document_label || issue.document_type || "未返回单据归属"}
            </Badge>
          </div>
          <p className="text-sm font-black leading-6">{resolveIssueMessage(issue)}</p>
        </div>
        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em]">
          <Badge variant="secondary">{resolveConfidence(issue.confidence)}</Badge>
          <span className="inline-flex items-center gap-1">
            展开
            <ChevronDown
              size={16}
              strokeWidth={3}
              className="transition-transform duration-100 ease-linear group-open:rotate-180"
            />
          </span>
        </div>
      </summary>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="border-4 border-ink bg-paper p-3 shadow-neo-sm">
          <p className="text-xs font-black uppercase tracking-[0.14em]">问题说明</p>
          <p className="mt-2 text-sm font-bold leading-6">{resolveIssueMessage(issue)}</p>
        </div>
        <div className="border-4 border-ink bg-paper p-3 shadow-neo-sm">
          <p className="text-xs font-black uppercase tracking-[0.14em]">处理建议</p>
          <p className="mt-2 text-sm font-bold leading-6">{resolveIssueSuggestion(issue)}</p>
        </div>
      </div>
    </details>
  );
}

export function HistoryDetail({
  item,
  loading,
  error,
  onRetry,
  onGoAudit
}: HistoryDetailProps) {
  const issues = item?.audit_result?.issues ?? [];
  const documentResults = item?.audit_result?.documents ?? [];
  const notes = item?.audit_result?.notes ?? [];
  const summary = summarizeSeverity(item?.audit_result?.summary);
  const resolvedStatus = resolveHistoryStatus();
  const hasMinimalDetail =
    Boolean(item) &&
    !item?.audit_result?.message &&
    issues.length === 0 &&
    documentResults.length === 0 &&
    notes.length === 0;

  return (
    <Card className="bg-muted">
      <CardHeader>
        <Badge variant="inverse">详情查看</Badge>
        <CardTitle>审核详情回看</CardTitle>
        <CardDescription>
          这里已接上历史详情接口，会按后端当前真实详情结构展示基本信息、审核摘要、问题明细和报告说明。
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
              <p className="flex items-center gap-2 text-sm font-bold leading-6">
                <AlertCircle size={18} strokeWidth={3} />
                {error}
              </p>
            </div>
            <Button variant="outline" onClick={onRetry}>
              <RefreshCcw size={18} strokeWidth={3} />
              重新读取详情
            </Button>
          </div>
        ) : item ? (
          <>
            <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2">
                  <p className="text-2xl font-black tracking-tight">
                    {formatHistoryTitle(item)}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="inverse">
                      {resolveHistoryStatusLabel(resolvedStatus)}
                    </Badge>
                    <Badge variant="muted">{item.model_used}</Badge>
                    <Badge variant="secondary">{item.document_count} 份单据</Badge>
                    <Badge variant="neutral">
                      自定义规则快照 {item.custom_rules_snapshot.length} 条
                    </Badge>
                  </div>
                </div>
                <Button onClick={onGoAudit}>
                  <ArrowRight size={18} strokeWidth={3} />
                  返回审核工作台
                </Button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
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
                <p className="text-xs font-black uppercase tracking-[0.14em]">创建时间</p>
                <p className="mt-2 text-sm font-bold leading-6">
                  {formatHistoryDate(item.created_at)}
                </p>
              </div>
              <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
                <p className="text-xs font-black uppercase tracking-[0.14em]">更新时间</p>
                <p className="mt-2 text-sm font-bold leading-6">
                  {formatHistoryDate(item.updated_at)}
                </p>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
              <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">
                    深度思考 {item.deep_think_used ? "已开启" : "未开启"}
                  </Badge>
                  <Badge variant="muted">
                    审核{resolveConfidence(item.audit_result?.confidence)}
                  </Badge>
                </div>
                <p className="mt-3 text-sm font-bold leading-6">
                  {item.audit_result?.message ||
                    (hasMinimalDetail
                      ? "当前后端仅返回最小详情结构，尚未补充额外审核摘要。"
                      : "后端当前未返回额外审核摘要。")}
                </p>
              </div>

              <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
                <p className="text-xs font-black uppercase tracking-[0.14em]">汇总对齐</p>
                <p className="mt-2 text-sm font-bold leading-6">
                  详情里的 `audit_result.summary` 如已返回，会显示为 RED {summary.red} /
                  YELLOW {summary.yellow} / BLUE {summary.blue}。
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-black uppercase tracking-tight">问题明细</h3>
                <Badge variant="accent">{issues.length} 条</Badge>
              </div>
              <ScrollArea className="max-h-[26rem] bg-paper">
                <div className="space-y-3">
                  {issues.length > 0 ? (
                    issues.map((issue, index) => (
                      <IssueCard
                        key={issue.id || `${issue.field_name || "issue"}-${index}`}
                        issue={issue}
                        index={index}
                      />
                    ))
                  ) : (
                    <div className="issue-blue p-4">
                      <p className="text-sm font-bold leading-6">
                        当前详情里没有返回问题列表，或这条记录暂未包含问题明细。
                      </p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-black uppercase tracking-tight">审核摘要</h3>
                <Badge variant="muted">{notes.length} 条备注</Badge>
              </div>
              {notes.length > 0 ? (
                <div className="space-y-3">
                  {notes.map((note, index) => (
                    <div
                      key={`${note.slice(0, 24)}-${index}`}
                      className="border-4 border-ink bg-paper p-4 shadow-neo-sm"
                    >
                      <p className="text-sm font-bold leading-6">{note}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
                  <p className="text-sm font-bold leading-6">
                    当前后端没有返回额外摘要备注，这里先诚实展示为空。
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-black uppercase tracking-tight">逐单据回看</h3>
                <Badge variant="secondary">{documentResults.length} 条</Badge>
              </div>
              {documentResults.length > 0 ? (
                <div className="grid gap-3">
                  {documentResults.map((document, index) => (
                    <div
                      key={`${document.file_id || document.doc_type || "document"}-${index}`}
                      className="border-4 border-ink bg-paper p-4 shadow-neo-sm"
                    >
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="inverse">
                          {document.doc_type || "未返回单据类型"}
                        </Badge>
                        <Badge variant="muted">
                          提供方 {document.provider || "未返回"}
                        </Badge>
                        <Badge variant="secondary">
                          {resolveDocumentCount(document)} 条问题
                        </Badge>
                      </div>
                      <p className="mt-3 text-sm font-bold leading-6">
                        {document.result?.message ||
                          "当前后端逐单据结果未返回额外说明，这里先展示基础结构。"}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
                  <p className="text-sm font-bold leading-6">
                    当前详情接口还没有返回逐单据回看结构，后续可以继续补强这部分联调。
                  </p>
                </div>
              )}
            </div>

            <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
              <div className="flex items-center gap-2">
                <FileText size={18} strokeWidth={3} />
                <p className="text-sm font-black uppercase tracking-[0.14em]">报告信息</p>
              </div>
              <p className="mt-3 text-sm font-bold leading-6">
                当前历史详情接口尚未返回独立报告地址。本页会明确提示这一点；如需查看报告状态，仍应回到 `/audit` 工作台使用现有报告入口。
              </p>
            </div>
          </>
        ) : (
          <div className="issue-yellow p-4">
            <p className="text-sm font-bold leading-6">
              请先从左侧选择一条历史记录，右侧会加载本次审核的详情回看。
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
