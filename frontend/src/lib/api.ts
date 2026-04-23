import type { ApiError, ApiSuccess, AuditProgressEvent } from "@/types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api";
const ACCESS_TOKEN_KEY = "order-audit-access-token";

type RequestOptions = {
  token?: string | null;
  body?: unknown;
};

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

function buildHeaders(token?: string | null): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

async function request<T>(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  options: RequestOptions = {}
): Promise<ApiSuccess<T>> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    cache: "no-store",
    headers: buildHeaders(options.token),
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  return parseResponse<T>(response);
}

export async function apiGet<T>(
  path: string,
  options: Omit<RequestOptions, "body"> = {}
): Promise<ApiSuccess<T>> {
  return request<T>(path, "GET", options);
}

export async function apiPost<T>(
  path: string,
  body?: unknown,
  options: Omit<RequestOptions, "body"> = {}
): Promise<ApiSuccess<T>> {
  return request<T>(path, "POST", { ...options, body });
}

export async function apiPut<T>(
  path: string,
  body?: unknown,
  options: Omit<RequestOptions, "body"> = {}
): Promise<ApiSuccess<T>> {
  return request<T>(path, "PUT", { ...options, body });
}

export function getStoredAccessToken() {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function setStoredAccessToken(token: string) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(ACCESS_TOKEN_KEY, token);
}

export function clearStoredAccessToken() {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
}

export function createAuditEventSource(path: string) {
  return new EventSource(`${API_BASE_URL}${path}`);
}

export function parseAuditEvent(raw: MessageEvent<string>): AuditProgressEvent {
  return JSON.parse(raw.data) as AuditProgressEvent;
}
