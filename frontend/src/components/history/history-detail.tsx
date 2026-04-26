import { useState } from "react";
import { AlertCircle, ArrowRight, ChevronDown, Download, FileText, RefreshCcw } from "lucide-react";

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
import { downloadAuditReport } from "@/lib/api";

type HistoryReportType = "marked" | "detailed" | "zip";

type HistoryDetailProps = {
  item: HistoryDetailRecord | null;
  loading: boolean;
  error: string | null;
  token: string | null;
  onRetry: () => void;
  onGoAudit: () => void;
};

const REPORT_BUTTONS: Array<{ type: HistoryReportType; label: string }> = [
  { type: "marked", label: "标记版 Excel" },
  { type: "detailed", label: "详情版 Excel" },
  { type: "zip", label: "完整报告 ZIP" }
];

function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // 延迟释放 object URL，规避部分浏览器在 click 同步释放后下载失败的兼容性问题。
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

function normalizeDownloadError(error: unknown, fallback: string) {
  if (typeof error === "object" && error && "detail" in error) {
    const detail = (error as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.length > 0) {
      return detail;
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

function HistoryReportSection({
  taskId,
  token
}: {
  taskId: string | null | undefined;
  token: string | null;
}) {
  const [loadingType, setLoadingType] = useState<HistoryReportType | null>(null);
  const [errors, setErrors] = useState<Partial<Record<HistoryReportType, string>>>({});

  const hasTask = typeof taskId === "string" && taskId.length > 0;

  const handleDownload = async (reportType: HistoryReportType) => {
    if (!hasTask || !taskId) {
      return;
    }
    if (!token) {
      setErrors((prev) => ({
        ...prev,
        [reportType]: "登录态已过期，请重新登录后再下载报告。"
      }));
      return;
    }

    setLoadingType(reportType);
    setErrors((prev) => {
      const next = { ...prev };
      delete next[reportType];
      return next;
    });

    try {
      const { blob, filename } = await downloadAuditReport(taskId, reportType, { token });
      triggerBrowserDownload(blob, filename);
    } catch (error) {
      setErrors((prev) => ({
        ...prev,
        [reportType]: normalizeDownloadError(error, "下载失败，请稍后重试。")
      }));
    } finally {
      setLoadingType(null);
    }
  };

  return (
    <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
      <div className="flex items-center gap-2">
        <FileText size={18} strokeWidth={3} />
        <p className="text-sm font-black uppercase tracking-[0.14em]">报告下载</p>
      </div>

      {hasTask ? (
        <>
          <p className="mt-3 text-sm font-bold leading-6">
            本条历史记录已关联报告任务，可下载标记版 Excel、详情版 Excel 或完整 ZIP 打包。下载前会校验当前登录状态。
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {REPORT_BUTTONS.map(({ type, label }) => {
              const isLoading = loadingType === type;
              const disabled = !token || loadingType !== null;
              return (
                <div key={type} className="flex flex-col gap-1">
                  <Button
                    variant="outline"
                    onClick={() => {
                      void handleDownload(type);
                    }}
                    disabled={disabled}
                  >
                    <Download size={18} strokeWidth={3} />
                    {isLoading ? "下载中..." : label}
                  </Button>
                  {errors[type] ? (
                    <p className="max-w-xs text-xs font-bold leading-5 text-[color:var(--color-danger,#c0392b)]">
                      {errors[type]}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
          {!token ? (
            <p className="mt-3 text-xs font-bold leading-5">
              当前登录态尚未就绪，按钮已禁用；登录恢复后即可下载。
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-3 text-sm font-bold leading-6">
          该历史记录为早期版本，报告文件不可用。
        </p>
      )}
    </div>
  );
}

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
  return issue.finding || issue.message || "当前记录没有更详细的问题说明。";
}

function resolveIssueSuggestion(issue: HistoryIssue) {
  return issue.suggestion || "当前记录没有修正建议。";
}

function resolveConfidence(confidence?: number) {
  if (typeof confidence !== "number") {
    return "暂未提供置信度";
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
  token,
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
          这里展示所选审核记录的基本信息、审核摘要、问题明细和报告入口。
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
                      ? "当前记录仅包含基础信息，暂未补充额外审核摘要。"
                      : "当前记录没有额外审核摘要。")}
                </p>
              </div>

              <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
                <p className="text-xs font-black uppercase tracking-[0.14em]">汇总对齐</p>
                <p className="mt-2 text-sm font-bold leading-6">
                  本次审核汇总为 RED {summary.red} / YELLOW {summary.yellow} /
                  BLUE {summary.blue}。
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
                    当前记录没有额外摘要备注。
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
                          "当前单据结果没有额外说明。"}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
                  <p className="text-sm font-bold leading-6">
                    当前记录还没有逐单据回看内容。
                  </p>
                </div>
              )}
            </div>

            <HistoryReportSection taskId={item.task_id} token={token} />
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
