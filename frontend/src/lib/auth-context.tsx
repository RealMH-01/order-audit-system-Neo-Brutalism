"use client";

import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode
} from "react";

import type { AuthAction, AuthContextValue, AuthState } from "@/types";

const initialState: AuthState = {
  status: "idle",
  user: null,
  error: null
};

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case "AUTH_START":
      return { ...state, status: "loading", error: null };
    case "AUTH_SUCCESS":
      return { status: "authenticated", user: action.payload, error: null };
    case "AUTH_FAILURE":
      return { ...state, status: "error", error: action.payload };
    case "SIGN_OUT":
      return initialState;
    default:
      return state;
  }
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function buildValue(
  state: AuthState,
  dispatch: Dispatch<AuthAction>
): AuthContextValue {
  return {
    state,
    dispatch,
    signOut: () => dispatch({ type: "SIGN_OUT" })
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, initialState);
  const value = useMemo(() => buildValue(state, dispatch), [state, dispatch]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("认证上下文未挂载，请检查 AppProviders。");
  }
  return context;
}

