import type { Dispatch } from "react";

export type ApiSuccess<T> = {
  data: T;
};

export type ApiError = {
  status: number;
  detail: string;
};

export type AuthUser = {
  id: string;
  email: string;
};

export type AuthState = {
  status: "idle" | "loading" | "authenticated" | "error";
  user: AuthUser | null;
  error: string | null;
};

export type AuthAction =
  | { type: "AUTH_START" }
  | { type: "AUTH_SUCCESS"; payload: AuthUser }
  | { type: "AUTH_FAILURE"; payload: string }
  | { type: "SIGN_OUT" };

export type AuthContextValue = {
  state: AuthState;
  dispatch: Dispatch<AuthAction>;
  signOut: () => void;
};

export type AuditDocument = {
  id: string;
  name: string;
  kind: "po" | "invoice" | "packing_list" | "shipping_instruction" | "other";
};

export type AuditProgressEvent = {
  step: string;
  message: string;
  level: "info" | "warning" | "error";
};

export type AuditState = {
  status: "idle" | "uploading" | "parsing" | "auditing" | "completed" | "error";
  baseDocument: AuditDocument | null;
  pendingDocuments: AuditDocument[];
  progressEvents: AuditProgressEvent[];
};

export type AuditAction =
  | { type: "SET_BASE_DOCUMENT"; payload: AuditDocument | null }
  | { type: "SET_PENDING_DOCUMENTS"; payload: AuditDocument[] }
  | { type: "APPEND_PROGRESS_EVENT"; payload: AuditProgressEvent }
  | { type: "SET_AUDIT_STATUS"; payload: AuditState["status"] }
  | { type: "RESET_AUDIT" };

export type AuditContextValue = {
  state: AuditState;
  dispatch: Dispatch<AuditAction>;
  reset: () => void;
};

