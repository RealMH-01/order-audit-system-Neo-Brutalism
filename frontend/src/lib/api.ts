import type { ApiError, ApiSuccess } from "@/types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api";
const ACCESS_TOKEN_KEY = "order-audit-access-token";
let isRedirecting = false;

type RequestOptions = {
  token?: string | null;
  body?: unknown;
};

type UploadOptions = {
  token?: string | null;
  fieldName?: string;
  signal?: AbortSignal;
};

type StreamOptions<T> = {
  token?: string | null;
  signal?: AbortSignal;
  onMessage: (payload: T) => void;
};

type DownloadAuditReportOptions = {
  token?: string | null;
};

type DownloadAuditReportResult = {
  blob: Blob;
  filename: string;
};

async function parseResponse<T>(response: Response): Promise<ApiSuccess<T>> {
  const responseText = await response.text();

  if (!response.ok) {
    handleUnauthorizedResponse(response.status);

    let detail = "请求失败，请稍后重试。";

    if (responseText) {
      try {
        const body = JSON.parse(responseText) as { detail?: string };
        if (body.detail) {
          detail = body.detail;
        }
      } catch {
        detail = responseText;
      }
    }

    const error: ApiError = {
      status: response.status,
      detail
    };
    throw error;
  }

  const data = responseText ? (JSON.parse(responseText) as T) : (undefined as T);
  return { data };
}

function handleUnauthorizedResponse(status: number) {
  if (status !== 401 && status !== 403) {
    return;
  }

  clearStoredAccessToken();
  if (typeof window === "undefined" || isRedirecting) {
    return;
  }

  isRedirecting = true;
  window.location.href = "/login";
}

function buildHeaders(token?: string | null, hasBody = false): HeadersInit {
  return {
    ...(hasBody ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

function buildAuthHeaders(token?: string | null): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function parseFilenameFromDisposition(
  contentDisposition: string | null,
  fallbackFilename: string
) {
  if (!contentDisposition) {
    return fallbackFilename;
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const asciiMatch = contentDisposition.match(/filename=\"?([^\";]+)\"?/i);
  if (asciiMatch?.[1]) {
    return asciiMatch[1];
  }

  return fallbackFilename;
}

async function request<T>(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  options: RequestOptions = {}
): Promise<ApiSuccess<T>> {
  const hasBody = options.body !== undefined;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    cache: "no-store",
    headers: buildHeaders(options.token, hasBody),
    body: hasBody ? JSON.stringify(options.body) : undefined
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

export async function apiDelete<T>(
  path: string,
  options: RequestOptions = {}
): Promise<ApiSuccess<T>> {
  return request<T>(path, "DELETE", options);
}

export async function apiUploadFile<T>(
  path: string,
  file: File,
  options: UploadOptions = {}
): Promise<ApiSuccess<T>> {
  const formData = new FormData();
  formData.append(options.fieldName ?? "upload", file);

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    cache: "no-store",
    headers: buildAuthHeaders(options.token),
    body: formData,
    signal: options.signal
  });

  return parseResponse<T>(response);
}

export async function downloadAuditReport(
  taskId: string,
  reportType: "marked" | "detailed" | "zip",
  options: DownloadAuditReportOptions = {}
): Promise<DownloadAuditReportResult> {
  const fallbackFilename = {
    marked: `audit_marked_${taskId}.xlsx`,
    detailed: `audit_detailed_${taskId}.xlsx`,
    zip: `audit_reports_${taskId}.zip`
  }[reportType];

  const response = await fetch(
    `${API_BASE_URL}/audit/tasks/${taskId}/reports/${reportType}`,
    {
      method: "GET",
      cache: "no-store",
      headers: buildAuthHeaders(options.token)
    }
  );

  if (!response.ok) {
    handleUnauthorizedResponse(response.status);

    let detail = "报告下载失败，请稍后重试。";

    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) {
        detail = body.detail;
      }
    } catch {
      const rawText = await response.text();
      if (rawText) {
        detail = rawText;
      }
    }

    const error: ApiError = {
      status: response.status,
      detail
    };
    throw error;
  }

  return {
    blob: await response.blob(),
    filename: parseFilenameFromDisposition(
      response.headers.get("Content-Disposition"),
      fallbackFilename
    )
  };
}

function extractEventData(bufferChunk: string) {
  const dataLine = bufferChunk
    .split("\n")
    .find((line) => line.startsWith("data: "));

  if (!dataLine) {
    return null;
  }

  return dataLine.slice(6);
}

export async function streamJsonEvents<T>(
  path: string,
  { token, signal, onMessage }: StreamOptions<T>
) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "GET",
    cache: "no-store",
    headers: {
      Accept: "text/event-stream",
      ...buildAuthHeaders(token)
    },
    signal
  });

  if (!response.ok) {
    await parseResponse<never>(response);
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const error: ApiError = {
      status: 500,
      detail: "进度流建立失败，请稍后重试。"
    };
    throw error;
  }

  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      const rawData = extractEventData(chunk);
      if (!rawData) {
        continue;
      }

      const payload = JSON.parse(rawData) as T;
      onMessage(payload);
    }
  }
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
