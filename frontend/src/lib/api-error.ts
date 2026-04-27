export const LOGIN_EXPIRED_MESSAGE = "登录已过期，请重新登录后继续。";

export const TECHNICAL_ERROR_MESSAGE =
  "系统暂时无法处理该请求，请稍后重试。如果问题持续，请联系管理员。";

const AUTH_ERROR_PATTERN =
  /登录已过期|token expired|expired token|jwt expired|invalid token|invalid jwt|登录态.*失效/i;

const TECHNICAL_ERROR_PATTERN =
  /supabase|postgrest|postgresql|postgres|database|relation|traceback|keyerror|stack trace|sql|syntax error|duplicate key|foreign key|violates constraint|null value|pgrst|python|exception|column|table|schema|fastapi|raw response/i;

function extractErrorText(input: unknown): string | null {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof Error && input.message) {
    return input.message;
  }

  if (typeof input !== "object" || !input) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const candidate = record.detail ?? record.message ?? record.error;

  if (typeof candidate === "string") {
    return candidate;
  }

  return null;
}

export function normalizeApiErrorDetail(
  input: unknown,
  fallback = "请求失败，请稍后重试。"
) {
  const detail = extractErrorText(input)?.trim();

  if (!detail) {
    return fallback;
  }

  if (AUTH_ERROR_PATTERN.test(detail)) {
    return LOGIN_EXPIRED_MESSAGE;
  }

  if (TECHNICAL_ERROR_PATTERN.test(detail)) {
    return TECHNICAL_ERROR_MESSAGE;
  }

  return detail;
}
