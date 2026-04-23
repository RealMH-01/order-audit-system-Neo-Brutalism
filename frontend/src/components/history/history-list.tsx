import { Clock3, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

import type { HistoryListItem, HistoryStatusFilter } from "@/components/history/types";

type HistoryListProps = {
  items: HistoryListItem[];
  loading: boolean;
  activeId: string | null;
  filter: HistoryStatusFilter;
  onFilterChange: (filter: HistoryStatusFilter) => void;
  onSelect: (id: string) => void;
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

function formatHistoryTitle(item: HistoryListItem) {
  return `审核记录 ${item.id.slice(0, 8)}`;
}

export function HistoryList({
  items,
  loading,
  activeId,
  filter,
  onFilterChange,
  onSelect
}: HistoryListProps) {
  return (
    <Card className="bg-paper">
      <CardHeader>
        <Badge variant="accent">历史列表</Badge>
        <CardTitle>最近审核记录</CardTitle>
        <CardDescription>
          当前后端列表会返回最近记录的基础摘要。状态字段没有单独返回，因此这里按历史记录语义统一展示为“已完成”。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <Button
            variant={filter === "ALL" ? "primary" : "outline"}
            onClick={() => onFilterChange("ALL")}
          >
            全部记录
          </Button>
          <Button
            variant={filter === "COMPLETED" ? "primary" : "outline"}
            onClick={() => onFilterChange("COMPLETED")}
          >
            已完成
          </Button>
        </div>

        <ScrollArea className="max-h-[40rem] bg-paper">
          <div className="space-y-3">
            {loading ? (
              <div className="border-4 border-ink bg-canvas p-4 shadow-neo-sm">
                <p className="text-sm font-bold leading-6">正在加载审核历史列表...</p>
              </div>
            ) : items.length > 0 ? (
              items.map((item) => (
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
                      <p className="text-lg font-black tracking-tight">{formatHistoryTitle(item)}</p>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="inverse">已完成</Badge>
                        <Badge variant="muted">{item.model_used}</Badge>
                        <Badge variant="secondary">{item.document_count} 份文件</Badge>
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
                      {formatDate(item.created_at)}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="issue-red p-3">
                      <p className="text-xs font-black uppercase tracking-[0.14em]">RED</p>
                      <p className="mt-2 text-2xl font-black leading-none">{item.red_count}</p>
                    </div>
                    <div className="issue-yellow p-3">
                      <p className="text-xs font-black uppercase tracking-[0.14em]">YELLOW</p>
                      <p className="mt-2 text-2xl font-black leading-none">{item.yellow_count}</p>
                    </div>
                    <div className="issue-blue p-3">
                      <p className="text-xs font-black uppercase tracking-[0.14em]">BLUE</p>
                      <p className="mt-2 text-2xl font-black leading-none">{item.blue_count}</p>
                    </div>
                  </div>
                </button>
              ))
            ) : (
              <div className="issue-yellow p-4">
                <p className="text-sm font-bold leading-6">
                  当前还没有可展示的审核历史记录。你可以先回到审核工作台发起一次审核。
                </p>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
