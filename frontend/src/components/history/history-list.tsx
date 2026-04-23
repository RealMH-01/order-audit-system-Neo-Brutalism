import { AlertCircle, Clock3, RefreshCcw, Sparkles } from "lucide-react";

import {
  formatHistoryDate,
  formatHistoryTitle,
  resolveHistoryIssueTotal,
  resolveHistoryStatus,
  resolveHistoryStatusLabel
} from "@/components/history/history-utils";
import type { HistoryListItem, HistoryStatusFilter } from "@/components/history/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

type HistoryListProps = {
  items: HistoryListItem[];
  loading: boolean;
  error: string | null;
  activeId: string | null;
  filter: HistoryStatusFilter;
  onFilterChange: (filter: HistoryStatusFilter) => void;
  onSelect: (id: string) => void;
  onRetry: () => void;
};

const FILTER_OPTIONS: Array<{
  value: HistoryStatusFilter;
  label: string;
}> = [
  { value: "ALL", label: "全部记录" },
  { value: "COMPLETED", label: "已完成" }
];

export function HistoryList({
  items,
  loading,
  error,
  activeId,
  filter,
  onFilterChange,
  onSelect,
  onRetry
}: HistoryListProps) {
  return (
    <Card className="bg-paper">
      <CardHeader>
        <Badge variant="accent">历史列表</Badge>
        <CardTitle>最近审核记录</CardTitle>
        <CardDescription>
          历史列表已接上 `/api/audit/history`。当前后端真实结构只沉淀已完成的记录，因此失败和取消任务暂时不会出现在这里。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-3">
            {FILTER_OPTIONS.map((option) => (
              <Button
                key={option.value}
                variant={filter === option.value ? "primary" : "outline"}
                onClick={() => onFilterChange(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
          <Badge variant="muted">{items.length} 条可见记录</Badge>
        </div>

        <div className="border-4 border-ink bg-canvas p-4 shadow-neo-sm">
          <p className="text-sm font-bold leading-6">
            列表默认按最近创建时间优先展示。点击任一记录后，右侧会加载该次审核的真实详情结构。
          </p>
        </div>

        <ScrollArea className="max-h-[42rem] bg-paper">
          <div className="space-y-3">
            {loading ? (
              <div className="border-4 border-ink bg-canvas p-4 shadow-neo-sm">
                <p className="text-sm font-bold leading-6">正在加载审核历史列表...</p>
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
                  重新读取历史列表
                </Button>
              </div>
            ) : items.length > 0 ? (
              items.map((item) => {
                const resolvedStatus = resolveHistoryStatus();
                const issueTotal = resolveHistoryIssueTotal(item);

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelect(item.id)}
                    className={[
                      "w-full border-4 border-ink p-4 text-left shadow-neo-sm transition-all duration-100 ease-linear",
                      activeId === item.id
                        ? "bg-acid"
                        : "bg-canvas hover:-translate-y-0.5 hover:bg-secondary"
                    ].join(" ")}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-2">
                        <p className="text-lg font-black tracking-tight">
                          {formatHistoryTitle(item)}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="inverse">
                            {resolveHistoryStatusLabel(resolvedStatus)}
                          </Badge>
                          <Badge variant="muted">{item.model_used}</Badge>
                          <Badge variant="secondary">{item.document_count} 份单据</Badge>
                          <Badge variant="neutral">{issueTotal} 项问题</Badge>
                          {item.deep_think_used ? (
                            <Badge variant="accent">
                              <Sparkles size={12} strokeWidth={3} />
                              深度思考
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em]">
                        <Clock3 size={14} strokeWidth={3} />
                        {formatHistoryDate(item.created_at)}
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <div className="issue-red p-3">
                        <p className="text-xs font-black uppercase tracking-[0.14em]">RED</p>
                        <p className="mt-2 text-2xl font-black leading-none">{item.red_count}</p>
                      </div>
                      <div className="issue-yellow p-3">
                        <p className="text-xs font-black uppercase tracking-[0.14em]">
                          YELLOW
                        </p>
                        <p className="mt-2 text-2xl font-black leading-none">
                          {item.yellow_count}
                        </p>
                      </div>
                      <div className="issue-blue p-3">
                        <p className="text-xs font-black uppercase tracking-[0.14em]">BLUE</p>
                        <p className="mt-2 text-2xl font-black leading-none">{item.blue_count}</p>
                      </div>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="issue-yellow p-4">
                <p className="text-sm font-bold leading-6">
                  当前还没有可查看的审核历史。你可以先回到审核工作台完成一次审核，历史页就会出现对应记录。
                </p>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
