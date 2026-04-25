import { Loader2, PauseCircle, Square, StopCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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
      return "等待中";
    case "running":
      return "审核进行中";
    case "completed":
      return "已完成";
    case "failed":
      return "已失败";
    case "cancelled":
      return "已取消";
    case "cancelling":
      return "正在取消";
    default:
      return "待启动";
  }
}

function resolveStageHint(status: string, isStalled: boolean) {
  if (status === "queued") {
    return isStalled
      ? "任务仍在等待后端调度，页面会继续保持连接。"
      : "任务已进入队列，正在准备文件与审核上下文。";
  }
  if (status === "running") {
    return isStalled
      ? "暂时没有新的进度事件，通常表示后端仍在处理中。"
      : "后端正在解析文件、构造提示词并执行审核。";
  }
  if (status === "completed") {
    return "审核已经完成，可以查看结果与报告状态。";
  }
  if (status === "failed") {
    return "审核任务已经失败，请根据错误提示决定是否重试。";
  }
  if (status === "cancelled") {
    return "本轮审核已取消，你可以调整文件或配置后重新发起。";
  }
  if (status === "cancelling") {
    return "已收到取消请求，正在等待后端停止当前任务。";
  }
  return "启动审核后，这里会持续展示任务状态和阶段消息。";
}

function formatEventTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "刚刚";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

const FINISHED_STATUSES = new Set(["completed", "failed", "cancelled"]);

function safeParseTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) {
    return null;
  }
  return ms;
}

function resolveDurationSeconds(events: AuditProgressPayload[]): number | null {
  if (events.length < 2) {
    return null;
  }

  const firstEvent = events[0];
  const lastEvent = events[events.length - 1];

  const firstTime = safeParseTimestamp(firstEvent?.created_at);
  const lastTime =
    safeParseTimestamp(lastEvent?.updated_at) ??
    safeParseTimestamp(lastEvent?.created_at);

  if (firstTime === null || lastTime === null) {
    return null;
  }

  const durationSeconds = (lastTime - firstTime) / 1000;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return null;
  }

  return durationSeconds;
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
  const [now, setNow] = useState(Date.now());

  const active = taskId !== null && ["queued", "running", "cancelling"].includes(status);
  const lastEventAt = events.length > 0 ? events[events.length - 1]?.updated_at : null;

  useEffect(() => {
    if (!active) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 5000);

    return () => window.clearInterval(timer);
  }, [active]);

  const isStalled = useMemo(() => {
    if (!active || !lastEventAt) {
      return false;
    }

    const lastTimestamp = new Date(lastEventAt).getTime();
    if (Number.isNaN(lastTimestamp)) {
      return false;
    }

    return now - lastTimestamp >= 15000;
  }, [active, lastEventAt, now]);

  const durationSeconds = useMemo(() => {
    if (!FINISHED_STATUSES.has(status)) {
      return null;
    }
    return resolveDurationSeconds(events);
  }, [events, status]);

  const canCancel = active;

  return (
    <Card className="bg-secondary">
      <CardHeader>
        <Badge variant="inverse">进度区</Badge>
        <CardTitle>审核进度</CardTitle>
        <CardDescription>
          当前通过带鉴权的流式事件读取进度，重点让你始终看得懂任务进行到了哪一步。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="border-4 border-ink bg-paper p-4 shadow-neo-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <p className="text-xs font-black uppercase tracking-[0.14em]">
                当前状态
              </p>
              <p className="text-sm font-bold leading-6">{resolveStatusLabel(status)}</p>
            </div>
            <Badge variant={status === "completed" ? "secondary" : "accent"}>
              {progressPercent}%
            </Badge>
          </div>
          <Progress value={progressPercent} className="mt-4" />
          <p className="mt-4 text-sm font-bold leading-6">
            {message || "启动审核后，这里会显示当前阶段消息。"}
          </p>
          <p className="mt-2 text-sm font-bold leading-6">
            {resolveStageHint(status, isStalled)}
          </p>
          {isStalled ? (
            <div className="issue-yellow mt-4 p-3">
              <p className="text-sm font-bold leading-6">
                当前连接仍然有效，但后端暂时没有推送新进度，请稍等片刻。
              </p>
            </div>
          ) : null}
        </div>

        {durationSeconds !== null ? (
          <div className="border-4 border-ink bg-canvas p-3 shadow-neo-sm">
            <p className="text-sm font-bold leading-6">
              本轮审核耗时：{durationSeconds.toFixed(1)} 秒
            </p>
          </div>
        ) : null}

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
          {isStalled ? (
            <Badge variant="secondary">
              <PauseCircle size={14} strokeWidth={3} />
              暂无新事件
            </Badge>
          ) : null}
        </div>

        <ScrollArea className="max-h-72 bg-paper">
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
                        {event.progress_percent}% · {formatEventTime(event.updated_at)}
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
                  还没有进度事件。启动审核后，这里会持续刷新任务状态。
                </p>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
