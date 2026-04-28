import { useState } from "react";
import { ChevronDown, ClipboardList, Filter, History, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Dialog, DialogSection } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip } from "@/components/ui/tooltip";

import type {
  AuditIssue,
  AuditResultResponse,
  AuditRuleSnapshot,
  AuditRuleSnapshotSection
} from "@/components/audit/types";

type ResultFilter = "ALL" | "RED" | "YELLOW" | "BLUE";

type ResultsPanelProps = {
  result: AuditResultResponse | null;
  filter: ResultFilter;
  onFilterChange: (filter: ResultFilter) => void;
  onNavigateHistory?: () => void;
};

function resolveConfidencePercent(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const clamped = Math.max(0, Math.min(1, value));
  return Math.round(clamped * 100);
}

function resolveValidNotes(notes: unknown): string[] {
  if (!Array.isArray(notes)) {
    return [];
  }

  const cleaned: string[] = [];
  for (const note of notes) {
    if (typeof note !== "string") {
      continue;
    }
    const trimmed = note.trim();
    if (trimmed.length > 0) {
      cleaned.push(trimmed);
    }
  }
  return cleaned;
}

function resolveIssueClass(level: AuditIssue["level"]) {
  if (level === "RED") {
    return "issue-red";
  }
  if (level === "BLUE") {
    return "issue-blue";
  }
  return "issue-yellow";
}

function renderConfidence(issue: AuditIssue) {
  if (typeof issue.confidence !== "number") {
    return "置信度待补充";
  }

  return `置信度 ${Math.round(issue.confidence * 100)}%`;
}

function renderSuggestion(issue: AuditIssue) {
  return issue.suggestion?.trim() || "当前结果未附修正建议，请结合原单据与 PO 继续人工复核。";
}

function renderDocumentLabel(issue: AuditIssue) {
  return issue.document_label?.trim() || "当前结果未标注文档归属";
}

function renderOptionalText(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeTextList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") {
          return item.trim();
        }
        if (isRecord(item)) {
          return String(
            item.name ?? item.company_name ?? item.title ?? item.display_text ?? item.content ?? ""
          ).trim();
        }
        return String(item ?? "").trim();
      })
      .filter(Boolean);
  }

  if (typeof value === "string") {
    const text = value.trim();
    return text ? [text] : [];
  }

  return [];
}

function normalizeRuleText(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.replace(/^[-•\s]*/, "").trim())
    .filter(Boolean);
}

function normalizeRuleLines(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => {
        if (typeof item === "string") {
          return normalizeRuleText(item);
        }
        if (isRecord(item)) {
          const title = String(item.title ?? item.name ?? "").trim();
          const content = String(item.content ?? item.display_text ?? "").trim();
          if (title && content) {
            return `${title}：${content}`;
          }
          return String(title || content).trim();
        }
        return String(item ?? "").trim();
      })
      .filter(Boolean);
  }

  if (typeof value !== "string") {
    return [];
  }

  return normalizeRuleText(value);
}

function appendUniqueRules(target: string[], seen: Set<string>, value: unknown) {
  for (const rule of normalizeRuleLines(value)) {
    if (!seen.has(rule)) {
      seen.add(rule);
      target.push(rule);
    }
  }
}

function resolveSnapshotSectionTitle(section: AuditRuleSnapshotSection) {
  const record = section as Record<string, unknown>;
  return String(
    record.title ?? record.label ?? record.type ?? record.key ?? record.name ?? ""
  ).trim();
}

function resolveSnapshotSectionRules(section: AuditRuleSnapshotSection) {
  const record = section as Record<string, unknown>;
  return record.rules ?? record.items ?? record.content ?? record.text ?? record.body ?? [];
}

function isSystemRuleSection(section: AuditRuleSnapshotSection) {
  const title = resolveSnapshotSectionTitle(section).toLowerCase();
  return title.includes("系统") || title.includes("system") || title.includes("hard");
}

function resolveRuleSetName(snapshot: AuditRuleSnapshot) {
  return (
    renderOptionalText(snapshot.template?.name) ??
    renderOptionalText(snapshot.selected_template?.name) ??
    "未选择规则集"
  );
}

function buildRuleSnapshotSummary(snapshot: AuditRuleSnapshot) {
  const systemRules: string[] = [];
  const customRuleSetRules: string[] = [];
  const seenSystemRules = new Set<string>();
  const seenCustomRuleSetRules = new Set<string>();
  const sections = Array.isArray(snapshot.resolved_sections)
    ? snapshot.resolved_sections
    : [];

  for (const section of sections) {
    if (isSystemRuleSection(section)) {
      appendUniqueRules(systemRules, seenSystemRules, resolveSnapshotSectionRules(section));
    } else {
      appendUniqueRules(customRuleSetRules, seenCustomRuleSetRules, resolveSnapshotSectionRules(section));
    }
  }

  appendUniqueRules(systemRules, seenSystemRules, snapshot.system_rules?.rules);
  appendUniqueRules(customRuleSetRules, seenCustomRuleSetRules, snapshot.template?.supplemental_rules);
  appendUniqueRules(customRuleSetRules, seenCustomRuleSetRules, snapshot.template_rules);
  appendUniqueRules(customRuleSetRules, seenCustomRuleSetRules, snapshot.supplemental_rules);
  appendUniqueRules(
    customRuleSetRules,
    seenCustomRuleSetRules,
    snapshot.temporary_rules ?? snapshot.run_supplemental_rules
  );

  const templateName = resolveRuleSetName(snapshot);
  const companyAffiliates = normalizeTextList(snapshot.company_affiliates);

  return {
    systemRules,
    customRuleSetRules,
    templateName,
    companyAffiliates
  };
}

function RuleSnapshotDialog({
  open,
  snapshot,
  onClose
}: {
  open: boolean;
  snapshot: AuditRuleSnapshot | null;
  onClose: () => void;
}) {
  if (!snapshot) {
    return null;
  }

  const summary = buildRuleSnapshotSummary(snapshot);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="本次审核规则来源"
      footer={
        <Button variant="outline" onClick={onClose}>
          关闭
        </Button>
      }
    >
      <DialogSection>
        <div className="grid gap-3 md:grid-cols-2">
          <DetailTile
            label="系统硬约束规则"
            value={`${summary.systemRules.length} 条（不可关闭）`}
          />
          <DetailTile
            label="本次选择的自定义规则集"
            value={`「${summary.templateName}」${
              summary.customRuleSetRules.length > 0
                ? `；${summary.customRuleSetRules.length} 条`
                : ""
            }`}
          />
          <DetailTile
            label="关联公司 / 分工"
            value={
              summary.companyAffiliates.length > 0
                ? summary.companyAffiliates.join("、")
                : "无"
            }
          />
        </div>
        <div className="space-y-3">
          <RuleSnapshotSection
            title="系统硬约束规则"
            rules={summary.systemRules}
            emptyText="本次快照未保存系统硬约束规则明细。"
          />
          <RuleSnapshotSection
            title={`自定义规则集：${summary.templateName}`}
            rules={summary.customRuleSetRules}
            emptyText="本次未保存自定义规则集明细。"
          />
        </div>
      </DialogSection>
    </Dialog>
  );
}

function RuleSnapshotSection({
  title,
  rules,
  emptyText
}: {
  title: string;
  rules: string[];
  emptyText: string;
}) {
  return (
    <details className="border-4 border-ink bg-paper p-3 shadow-neo-sm">
      <summary className="cursor-pointer text-sm font-black">
        {title}（{rules.length} 条）
      </summary>
      {rules.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {rules.map((rule, index) => (
            <li key={`${rule.slice(0, 24)}-${index}`} className="text-sm font-bold leading-6">
              {rule}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm font-bold leading-6">{emptyText}</p>
      )}
    </details>
  );
}

function DetailTile({
  label,
  value,
  className = ""
}: {
  label: string;
  value: unknown;
  className?: string;
}) {
  const text = renderOptionalText(value);

  if (!text) {
    return null;
  }

  return (
    <div className={`border-4 border-ink bg-canvas p-3 shadow-neo-sm ${className}`}>
      <p className="text-xs font-black uppercase tracking-[0.14em]">{label}</p>
      <p className="mt-2 break-words text-sm font-bold leading-6">{text}</p>
    </div>
  );
}

function IssueContextGrid({ issue }: { issue: AuditIssue }) {
  const hasContext = [
    issue.document_label,
    issue.document_type,
    issue.matched_po_value,
    issue.observed_value,
    issue.source_excerpt
  ].some((value) => renderOptionalText(value));

  if (!hasContext) {
    return null;
  }

  return (
    <div className="mt-3 grid gap-3 md:grid-cols-2">
      <DetailTile label="来源单据" value={issue.document_label} />
      <DetailTile label="单据类型" value={issue.document_type} />
      <DetailTile label="PO 基准值" value={issue.matched_po_value} />
      <DetailTile label="目标观察值" value={issue.observed_value} />
      <DetailTile label="来源摘录" value={issue.source_excerpt} className="md:col-span-2" />
    </div>
  );
}

function IssueCard({ issue, index }: { issue: AuditIssue; index: number }) {
  return (
    <details className={`${resolveIssueClass(issue.level)} group p-4`} open={index < 2}>
      <summary className="flex cursor-pointer list-none flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Badge variant="inverse">{issue.level}</Badge>
            <Badge variant="neutral">
              {issue.field_name || "当前结果未标注字段名"}
            </Badge>
            <Badge variant="muted">{renderDocumentLabel(issue)}</Badge>
          </div>
          <p className="text-sm font-black leading-6">{issue.message}</p>
        </div>
        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em]">
          <Badge variant="secondary">{renderConfidence(issue)}</Badge>
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
          <p className="mt-2 text-sm font-bold leading-6">{issue.message}</p>
        </div>
        <div className="border-4 border-ink bg-paper p-3 shadow-neo-sm">
          <p className="text-xs font-black uppercase tracking-[0.14em]">修正建议</p>
          <p className="mt-2 text-sm font-bold leading-6">{renderSuggestion(issue)}</p>
        </div>
      </div>
      <IssueContextGrid issue={issue} />
    </details>
  );
}

export function ResultsPanel({
  result,
  filter,
  onFilterChange,
  onNavigateHistory
}: ResultsPanelProps) {
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const groups: Array<{ level: AuditIssue["level"]; title: string }> = [
    { level: "RED", title: "RED 严重问题" },
    { level: "YELLOW", title: "YELLOW 提醒问题" },
    { level: "BLUE", title: "BLUE 备注信息" }
  ];

  const filteredIssues =
    result?.issues.filter((issue) => (filter === "ALL" ? true : issue.level === filter)) ?? [];

  const confidencePercent = result ? resolveConfidencePercent(result.confidence) : null;
  const validNotes = result ? resolveValidNotes(result.notes) : [];
  const hasSummaryExtras = confidencePercent !== null || validNotes.length > 0;
  const ruleSnapshot =
    result?.rule_snapshot && Object.keys(result.rule_snapshot).length > 0
      ? result.rule_snapshot
      : null;
  const hasRuleSnapshot = ruleSnapshot !== null;

  return (
    <>
      <Card className="bg-paper">
      <CardHeader>
        <Badge variant="accent">结果区</Badge>
        <CardTitle>审核结果</CardTitle>
        <CardDescription>
          这里会显示汇总、颜色分组和问题列表。当前保持和后端真实返回结构一致，不会把缺失字段伪装成完整数据。
        </CardDescription>
        <div className="flex flex-wrap gap-3 pt-2">
          <Tooltip
            content={hasRuleSnapshot ? "查看本次审核规则" : "当前审核未记录规则快照"}
          >
            <span>
              <Button
                variant="outline"
                size="sm"
                disabled={!hasRuleSnapshot}
                onClick={() => setRuleDialogOpen(true)}
                className={!hasRuleSnapshot ? "cursor-not-allowed opacity-60" : ""}
              >
                <ClipboardList size={16} strokeWidth={3} />
                查看本次审核规则
              </Button>
            </span>
          </Tooltip>
        </div>
        {onNavigateHistory ? (
          <div className="pt-2">
            <Button variant="outline" size="sm" onClick={onNavigateHistory}>
              <History size={16} strokeWidth={3} />
              查看历史记录
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {result ? (
          <>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="issue-red p-4">
                <p className="text-xs font-black uppercase tracking-[0.14em]">RED</p>
                <p className="mt-2 text-3xl font-black leading-none">
                  {result.summary.red}
                </p>
              </div>
              <div className="issue-yellow p-4">
                <p className="text-xs font-black uppercase tracking-[0.14em]">
                  YELLOW
                </p>
                <p className="mt-2 text-3xl font-black leading-none">
                  {result.summary.yellow}
                </p>
              </div>
              <div className="issue-blue p-4">
                <p className="text-xs font-black uppercase tracking-[0.14em]">BLUE</p>
                <p className="mt-2 text-3xl font-black leading-none">
                  {result.summary.blue}
                </p>
              </div>
              <div className="border-4 border-ink bg-secondary p-4 shadow-neo-sm">
                <p className="text-xs font-black uppercase tracking-[0.14em]">
                  结果说明
                </p>
                <p className="mt-2 text-sm font-bold leading-6">{result.message}</p>
              </div>
            </div>

            {hasSummaryExtras ? (
              <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
                {confidencePercent !== null ? (
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.14em]">
                      整体置信度
                    </p>
                    <p className="mt-2 text-sm font-bold leading-6">
                      整体置信度：{confidencePercent}%
                    </p>
                  </div>
                ) : null}
                {validNotes.length > 0 ? (
                  <div className={confidencePercent !== null ? "mt-3" : ""}>
                    <p className="text-xs font-black uppercase tracking-[0.14em]">
                      审核备注
                    </p>
                    <ul className="mt-2 space-y-2">
                      {validNotes.map((note, index) => (
                        <li
                          key={`audit-note-${index}`}
                          className="text-sm font-bold leading-6"
                        >
                          {note}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-3">
              {(["ALL", "RED", "YELLOW", "BLUE"] as const).map((item) => (
                <Button
                  key={item}
                  variant={filter === item ? "primary" : "outline"}
                  onClick={() => onFilterChange(item)}
                >
                  <Filter size={16} strokeWidth={3} />
                  {item === "ALL" ? "全部问题" : item}
                </Button>
              ))}
            </div>

            <ScrollArea className="max-h-[34rem] p-0">
              <div className="space-y-5">
                {filter === "ALL"
                  ? groups.map((group) => {
                      const groupIssues = result.issues.filter(
                        (issue) => issue.level === group.level
                      );

                      return (
                        <section key={group.level} className="space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <Badge variant="inverse">{group.level}</Badge>
                              <h3 className="text-lg font-black uppercase tracking-tight">
                                {group.title}
                              </h3>
                            </div>
                            <Badge variant="muted">{groupIssues.length} 条</Badge>
                          </div>
                          {groupIssues.length > 0 ? (
                            <div className="space-y-3">
                              {groupIssues.map((issue, index) => (
                                <IssueCard
                                  key={`${group.level}-${issue.field_name}-${index}`}
                                  issue={issue}
                                  index={index}
                                />
                              ))}
                            </div>
                          ) : (
                            <div className="border-4 border-ink bg-canvas p-4 shadow-neo-sm">
                              <p className="text-sm font-bold leading-6">
                                当前没有这一类问题。
                              </p>
                            </div>
                          )}
                        </section>
                      );
                    })
                  : filteredIssues.length > 0
                    ? filteredIssues.map((issue, index) => (
                        <IssueCard
                          key={`${issue.level}-${issue.field_name}-${index}`}
                          issue={issue}
                          index={index}
                        />
                      ))
                    : (
                      <div className="border-4 border-ink bg-canvas p-4 shadow-neo-sm">
                        <p className="text-sm font-bold leading-6">
                          当前筛选条件下没有问题项。
                        </p>
                      </div>
                    )}
              </div>
            </ScrollArea>
          </>
        ) : (
          <div className="issue-blue p-4">
            <p className="flex items-center gap-2 text-sm font-bold leading-6">
              <ShieldAlert size={18} strokeWidth={3} />
              审核完成后，这里会显示 RED / YELLOW / BLUE 汇总和问题列表。
            </p>
          </div>
        )}
        </CardContent>
      </Card>
      <RuleSnapshotDialog
        open={ruleDialogOpen && hasRuleSnapshot}
        snapshot={ruleSnapshot}
        onClose={() => setRuleDialogOpen(false)}
      />
    </>
  );
}
