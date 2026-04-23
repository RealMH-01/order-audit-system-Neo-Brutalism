import { Filter, ShieldAlert } from "lucide-react";

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

import type { AuditIssue, AuditResultResponse } from "@/components/audit/types";

type ResultFilter = "ALL" | "RED" | "YELLOW" | "BLUE";

type ResultsPanelProps = {
  result: AuditResultResponse | null;
  filter: ResultFilter;
  onFilterChange: (filter: ResultFilter) => void;
};

function resolveIssueClass(level: AuditIssue["level"]) {
  if (level === "RED") {
    return "issue-red";
  }
  if (level === "BLUE") {
    return "issue-blue";
  }
  return "issue-yellow";
}

export function ResultsPanel({
  result,
  filter,
  onFilterChange
}: ResultsPanelProps) {
  const issues =
    result?.issues.filter((issue) => (filter === "ALL" ? true : issue.level === filter)) ?? [];

  return (
    <Card className="bg-paper">
      <CardHeader>
        <Badge variant="accent">结果区</Badge>
        <CardTitle>审核结果</CardTitle>
        <CardDescription>
          完成审核后会在这里显示汇总、问题列表和基础筛选。当前后端返回的是结构化结果，不是直接展示原始 JSON。
        </CardDescription>
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
                  总结
                </p>
                <p className="mt-2 text-sm font-bold leading-6">{result.message}</p>
              </div>
            </div>

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

            <ScrollArea className="max-h-[32rem] bg-paper">
              <div className="space-y-3">
                {issues.length > 0 ? (
                  issues.map((issue, index) => (
                    <div
                      key={`${issue.level}-${issue.field_name}-${index}`}
                      className={`${resolveIssueClass(issue.level)} p-4`}
                    >
                      <div className="flex flex-wrap items-center gap-3">
                        <Badge variant="inverse">{issue.level}</Badge>
                        <Badge variant="neutral">{issue.field_name}</Badge>
                        <Badge variant="muted">
                          {typeof issue.confidence === "number"
                            ? `置信度 ${(issue.confidence * 100).toFixed(0)}%`
                            : "后端暂未返回置信度"}
                        </Badge>
                      </div>
                      <p className="mt-3 text-sm font-bold leading-6">
                        {issue.message}
                      </p>
                    </div>
                  ))
                ) : (
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
  );
}
