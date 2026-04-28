"use client";

import { Loader2, ShieldCheck } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

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
  const { dispatch, signOut } = useAuth();
  const [ready, setReady] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const loginHref = pathname
    ? `/login?redirect=${encodeURIComponent(pathname)}`
    : "/login";

  useEffect(() => {
    setReady(false);
    setRedirecting(false);

    const token = getStoredAccessToken();

    if (!token) {
      clearStoredAccessToken();
      signOut();
      setRedirecting(true);
      router.replace(loginHref);
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
        setRedirecting(true);

        if (typeof error === "object" && error && "status" in error) {
          const status = Number(error.status);
          if (status === 401 || status === 403) {
            router.replace(loginHref);
            return;
          }
        }

        router.replace(loginHref);
      });

    return () => {
      cancelled = true;
    };
  }, [dispatch, loginHref, router, signOut]);

  if (ready) {
    return <>{children}</>;
  }

  return (
    <section className="page-shell">
      <Card className="bg-paper">
        <CardHeader>
          <CardTitle>{redirecting ? "正在前往登录页" : "正在验证登录状态"}</CardTitle>
          <CardDescription>
            {redirecting
              ? "请登录后继续访问该页面。"
              : "正在确认当前账号是否可以访问该页面。"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3 py-8">
          <Loader2 className="animate-spin" size={20} strokeWidth={3} />
          <p className="flex items-center gap-2 text-sm font-bold leading-6">
            <ShieldCheck size={18} strokeWidth={3} />
            {redirecting ? "正在跳转，请稍候..." : "正在验证登录状态..."}
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
