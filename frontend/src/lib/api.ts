import type { ApiError, ApiSuccess, AuditProgressEvent } from "@/types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api";

async function parseResponse<T>(response: Response): Promise<ApiSuccess<T>> {
  if (!response.ok) {
    let detail = "请求失败，请稍后重试。";

    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) {
        detail = body.detail;
      }
    } catch {
      // Keep the default Chinese error message.
    }

    const error: ApiError = {
      status: response.status,
      detail
    };
    throw error;
  }

  const data = (await response.json()) as T;
  return { data };
}

export async function apiGet<T>(path: string): Promise<ApiSuccess<T>> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "GET",
    cache: "no-store"
  });
  return parseResponse<T>(response);
}

export function createAuditEventSource(path: string) {
  return new EventSource(`${API_BASE_URL}${path}`);
}

export function parseAuditEvent(raw: MessageEvent<string>): AuditProgressEvent {
  return JSON.parse(raw.data) as AuditProgressEvent;
}
