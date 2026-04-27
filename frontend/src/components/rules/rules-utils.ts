import { normalizeApiErrorDetail } from "@/lib/api-error";

export function normalizeError(error: unknown, fallback: string) {
  return normalizeApiErrorDetail(error, fallback);
}

export function formatRulesDate(value: string | null) {
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
