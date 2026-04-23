import { Loader2, Square, StopCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";

import type { AuditProgressPayload } from "@/components/audit/types";

type ProgressPanelProps = {
  taskId: string | null;
  status: string;
  progressPercent: number;
  message: string;
  events: AuditProgressPayload[];
  cancelling: boolean;
  onCancel: () => void;
};

function resolveStatusLabel(status: string) {
  switch (status) {
    case "queued":
      return "排队中";
    case "running":
      return "审核中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    case "cancelling":
      return "取消中";
    default:
      return "待启动";
  }
}

export function ProgressPanel({
  taskId,
  status,
  progressPercent,
  message,
  events,
  cancelling,
  onCancel
}: ProgressPanelProps) {
  const canCancel =
    taskId !== null && (status === "queued" || status === "running" || status === "cancelling");

  return (
    <Card className="bg-secondary">
      <CardHeader>
        <Badge variant="inverse">进度区</Badge>
        <CardTitle>审核进度</CardTitle>
        <CardDescription>
          当前通过带鉴权的流式事件读取进度，优先保证阶段清楚、状态可见。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm font-black uppercase tracking-[0.14em]">
                当前状态
              </p>
              <p className="text-sm font-bold leading-6">
                {resolveStatusLabel(status)}
              </p>
            </div>
            <Badge variant={status === "completed" ? "secondary" : "accent"}>
              {progressPercent}%
            </Badge>
          </div>
          <Progress value={progressPercent} className="mt-4" />
          <p className="mt-4 text-sm font-bold leading-6">
            {message || "启动审核后，这里会显示当前阶段和实时进度。"}
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={!canCancel || cancelling}
          >
            {cancelling ? (
              <Loader2 size={18} strokeWidth={3} className="animate-spin" />
            ) : (
              <StopCircle size={18} strokeWidth={3} />
            )}
            {cancelling ? "取消中..." : "取消审核"}
          </Button>
          {taskId ? (
            <Badge variant="muted">任务 ID：{taskId.slice(0, 8)}</Badge>
          ) : (
            <Badge variant="neutral">
              <Square size={14} strokeWidth={3} />
              尚未创建任务
            </Badge>
          )}
        </div>

        <ScrollArea className="max-h-64 bg-paper">
          <div className="space-y-3">
            {events.length > 0 ? (
              events
                .slice()
                .reverse()
                .map((event, index) => (
                  <div
                    key={`${event.updated_at}-${index}`}
                    className="border-4 border-ink bg-canvas p-3 shadow-neo-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Badge variant="secondary">{resolveStatusLabel(event.status)}</Badge>
                      <span className="text-xs font-bold uppercase tracking-[0.14em]">
                        {event.progress_percent}%
                      </span>
                    </div>
                    <p className="mt-2 text-sm font-bold leading-6">
                      {event.message}
                    </p>
                  </div>
                ))
            ) : (
              <div className="border-4 border-ink bg-canvas p-4 shadow-neo-sm">
                <p className="text-sm font-bold leading-6">
                  还没有进度事件。启动审核后，这里会持续更新任务状态。
                </p>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
