import type {
  HistoryDetailRecord,
  HistoryListItem,
  HistoryResolvedStatus,
  HistorySeveritySummary,
  HistoryStatusFilter
} from "@/components/history/types";

type HistoryIdentity = {
  id: string | null;
  created_at: string | null;
};

type HistoryCounters = Pick<
  HistoryListItem | HistoryDetailRecord,
  "red_count" | "yellow_count" | "blue_count"
>;

export function formatHistoryDate(value: string | null) {
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

export function formatHistoryTitle(item: HistoryIdentity) {
  if (!item.id) {
    return "审核记录";
  }

  return `审核记录 #${item.id.slice(0, 8)}`;
}

export function resolveHistoryStatus(
  _item?: HistoryListItem | HistoryDetailRecord
): HistoryResolvedStatus {
  // The current history API only returns completed records, so there is no
  // separate task-status field to distinguish here yet.
  return "COMPLETED";
}

export function resolveHistoryStatusLabel(status: HistoryResolvedStatus) {
  if (status === "COMPLETED") {
    return "已完成";
  }

  return "状态未知";
}

export function resolveHistoryFilterLabel(filter: HistoryStatusFilter) {
  if (filter === "COMPLETED") {
    return "已完成";
  }

  return "全部记录";
}

export function sortHistoryItems(items: HistoryListItem[]) {
  return [...items].sort((left, right) => {
    const leftTime = left.created_at ? new Date(left.created_at).getTime() : 0;
    const rightTime = right.created_at ? new Date(right.created_at).getTime() : 0;
    return rightTime - leftTime;
  });
}

export function resolveHistoryIssueTotal(item: HistoryCounters) {
  return item.red_count + item.yellow_count + item.blue_count;
}

export function summarizeSeverity(summary?: HistorySeveritySummary) {
  return {
    red: summary?.red ?? 0,
    yellow: summary?.yellow ?? 0,
    blue: summary?.blue ?? 0
  };
}
