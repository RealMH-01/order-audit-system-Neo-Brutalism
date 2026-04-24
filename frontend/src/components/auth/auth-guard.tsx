"use client";

import { Loader2, ShieldCheck } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiGet, clearStoredAccessToken, getStoredAccessToken } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { AuthUser } from "@/types";

function toAuthUser(payload: {
  id: string;
  email: string;
  display_name?: string | null;
  role: "user" | "admin";
}): AuthUser {
  return {
    id: payload.id,
    email: payload.email,
    display_name: payload.display_name ?? null,
    role: payload.role
  };
}

export function AuthGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { state, dispatch, signOut } = useAuth();
  const [ready, setReady] = useState(false);
  const hasAuthenticatedContext =
    state.status === "authenticated" && state.user !== null;

  useEffect(() => {
    const token = getStoredAccessToken();

    if (!token) {
      clearStoredAccessToken();
      signOut();
      router.replace("/login");
      return;
    }

    if (hasAuthenticatedContext) {
      setReady(true);
      return;
    }

    let cancelled = false;
    dispatch({ type: "AUTH_START" });

    void apiGet<{
      id: string;
      email: string;
      display_name?: string | null;
      role: "user" | "admin";
    }>("/auth/me", { token })
      .then(({ data }) => {
        if (cancelled) {
          return;
        }

        dispatch({ type: "AUTH_SUCCESS", payload: toAuthUser(data) });
        setReady(true);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        clearStoredAccessToken();
        signOut();

        if (typeof error === "object" && error && "status" in error) {
          const status = Number(error.status);
          if (status === 401 || status === 403) {
            router.replace("/login");
            return;
          }
        }

        router.replace("/login");
      });

    return () => {
      cancelled = true;
    };
  }, [dispatch, hasAuthenticatedContext, router, signOut]);

  if (ready) {
    return <>{children}</>;
  }

  return (
    <section className="page-shell">
      <Card className="bg-paper">
        <CardHeader>
          <Badge variant="accent">Auth Guard</Badge>
          <CardTitle>正在验证登录状态</CardTitle>
          <CardDescription>
            {pathname
              ? `正在确认你是否有权限访问 ${pathname}。`
              : "正在确认你是否有权限访问当前页面。"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3 py-8">
          <Loader2 className="animate-spin" size={20} strokeWidth={3} />
          <p className="flex items-center gap-2 text-sm font-bold leading-6">
            <ShieldCheck size={18} strokeWidth={3} />
            登录校验中，请稍候…
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
