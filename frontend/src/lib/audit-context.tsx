"use client";

import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode
} from "react";

import type { AuditAction, AuditContextValue, AuditState } from "@/types";

const initialState: AuditState = {
  status: "idle",
  baseDocument: null,
  pendingDocuments: [],
  progressEvents: []
};

function auditReducer(state: AuditState, action: AuditAction): AuditState {
  switch (action.type) {
    case "SET_BASE_DOCUMENT":
      return { ...state, baseDocument: action.payload };
    case "SET_PENDING_DOCUMENTS":
      return { ...state, pendingDocuments: action.payload };
    case "APPEND_PROGRESS_EVENT":
      return { ...state, progressEvents: [...state.progressEvents, action.payload] };
    case "SET_AUDIT_STATUS":
      return { ...state, status: action.payload };
    case "RESET_AUDIT":
      return initialState;
    default:
      return state;
  }
}

const AuditContext = createContext<AuditContextValue | undefined>(undefined);

function buildValue(
  state: AuditState,
  dispatch: Dispatch<AuditAction>
): AuditContextValue {
  return {
    state,
    dispatch,
    reset: () => dispatch({ type: "RESET_AUDIT" })
  };
}

export function AuditProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(auditReducer, initialState);
  const value = useMemo(() => buildValue(state, dispatch), [state, dispatch]);

  return <AuditContext.Provider value={value}>{children}</AuditContext.Provider>;
}

export function useAudit() {
  const context = useContext(AuditContext);
  if (!context) {
    throw new Error("审核上下文未挂载，请检查 AppProviders。");
  }
  return context;
}

