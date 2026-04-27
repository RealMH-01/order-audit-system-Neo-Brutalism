export const LOGIN_EXPIRED_MESSAGE = "登录已过期，请重新登录后继续。";

export const TECHNICAL_ERROR_MESSAGE =
  "系统暂时无法处理该请求，请稍后重试。如果问题持续，请联系管理员。";

const AUTH_ERROR_PATTERN =
  /登录已过期|token expired|expired token|jwt expired|invalid token|invalid jwt|登录态.*失效/i;

const TECHNICAL_ERROR_PATTERN =
  /supabase|postgrest|postgresql|postgres|database|relation|traceback|keyerror|stack|stack trace|sql|syntax error|typeerror|referenceerror|validationerror|validation error|pydantic|duplicate key|foreign key|violates constraint|null value|pgrst|python|exception|column|table|schema|fastapi|raw response|internal server error|response body|doctype|<html/i;

const UNREADABLE_ERROR_PATTERN = /\[object Object\]|^\s*\{[\s\S]*\}\s*$|^\s*\[[\s\S]*\]\s*$/;

function isUnreadableText(value: string) {
  const text = value.trim();

  if (!text) {
    return false;
  }

  if (UNREADABLE_ERROR_PATTERN.test(text)) {
    return true;
  }

  const replacementChars = text.match(/\uFFFD/g)?.length ?? 0;
  if (replacementChars >= 2 || replacementChars / text.length > 0.05) {
    return true;
  }

  const controlChars = text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g)?.length ?? 0;
  return controlChars > 0;
}

function extractCandidateText(candidate: unknown): string | null {
  if (typeof candidate === "string") {
    return candidate;
  }

  if (candidate instanceof Error && candidate.message) {
    return candidate.message;
  }

  if (candidate instanceof ArrayBuffer || ArrayBuffer.isView(candidate)) {
    return null;
  }

  if (typeof Blob !== "undefined" && candidate instanceof Blob) {
    return null;
  }

  if (Array.isArray(candidate)) {
    for (const item of candidate) {
      const text = extractErrorText(item);
      if (text) {
        return text;
      }
    }
  }

  if (typeof candidate === "object" && candidate) {
    return extractErrorText(candidate);
  }

  return null;
}

function extractErrorText(input: unknown): string | null {
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input) as unknown;
      const parsedText = extractErrorText(parsed);
      if (parsedText) {
        return parsedText;
      }
    } catch {
      // Keep plain business messages intact when the string is not JSON.
    }

    return input;
  }

  if (input instanceof Error && input.message) {
    return input.message;
  }

  if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
    return null;
  }

  if (typeof Blob !== "undefined" && input instanceof Blob) {
    return null;
  }

  if (typeof input !== "object" || !input) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const candidate = record.detail ?? record.message ?? record.error;

  return extractCandidateText(candidate);
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

  if (isUnreadableText(detail)) {
    return fallback;
  }

  return detail;
}
