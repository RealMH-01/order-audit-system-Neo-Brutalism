"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, KeyRound, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";
import { apiPost, clearStoredAccessToken } from "@/lib/api";
import { normalizeApiErrorDetail } from "@/lib/api-error";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { MessageResponse } from "@/types";

const INVALID_LINK_MESSAGE = "重置链接无效或已过期，请重新发起密码重置。";
const RESET_SUCCESS_MESSAGE = "密码已重置，请使用新密码重新登录。";

type ResetLinkState = "checking" | "ready" | "invalid" | "success";

function normalizeResetError(error: unknown) {
  return normalizeApiErrorDetail(
    error,
    "密码重置失败或链接已过期，请重新发起密码重置。"
  );
}

function clearResetUrl() {
  if (typeof window === "undefined") {
    return;
  }
  window.history.replaceState(null, "", "/reset-password");
}

function readImplicitAccessToken() {
  if (typeof window === "undefined") {
    return null;
  }

  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return hashParams.get("access_token");
}

function readPkceCode() {
  if (typeof window === "undefined") {
    return null;
  }

  const queryParams = new URLSearchParams(window.location.search);
  return queryParams.get("code");
}

export default function ResetPasswordPage() {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [linkState, setLinkState] = useState<ResetLinkState>("checking");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const implicitAccessToken = readImplicitAccessToken();
      if (implicitAccessToken) {
        clearResetUrl();
        if (!cancelled) {
          setAccessToken(implicitAccessToken);
          setLinkState("ready");
        }
        return;
      }

      const code = readPkceCode();
      if (!code) {
        if (!cancelled) {
          setError(INVALID_LINK_MESSAGE);
          setLinkState("invalid");
        }
        return;
      }

      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        clearResetUrl();
        if (!cancelled) {
          setError(INVALID_LINK_MESSAGE);
          setLinkState("invalid");
        }
        return;
      }

      const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      const exchangedAccessToken = data.session?.access_token ?? null;

      clearResetUrl();
      if (cancelled) {
        return;
      }

      if (exchangeError || !exchangedAccessToken) {
        setError(INVALID_LINK_MESSAGE);
        setLinkState("invalid");
        return;
      }

      setAccessToken(exchangedAccessToken);
      setLinkState("ready");
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!accessToken) {
      setError(INVALID_LINK_MESSAGE);
      setLinkState("invalid");
      return;
    }
    if (!password.trim()) {
      setError("请输入新密码。");
      return;
    }
    if (password.trim().length < 6) {
      setError("密码至少需要 6 位。");
      return;
    }
    if (password !== confirmPassword) {
      setError("两次输入的密码必须一致。");
      return;
    }

    setSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const { data } = await apiPost<MessageResponse>("/auth/password-reset/confirm", {
        access_token: accessToken,
        password: password.trim()
      });
      clearStoredAccessToken();
      clearResetUrl();
      setAccessToken(null);
      setLinkState("success");
      setMessage(data.message || RESET_SUCCESS_MESSAGE);

      const supabase = getSupabaseBrowserClient();
      if (supabase) {
        try {
          await supabase.auth.signOut();
        } catch {
          // The password reset already succeeded; avoid showing a technical sign-out error.
        }
      }
    } catch (resetError) {
      setError(normalizeResetError(resetError));
    } finally {
      setSubmitting(false);
    }
  }, [accessToken, confirmPassword, password]);

  const showPasswordForm = linkState === "ready" && accessToken;
  const showReturnToLogin = linkState === "invalid" || linkState === "success";

  return (
    <main className="page-shell">
      <section className="mx-auto grid w-full max-w-4xl gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="bg-paper">
          <CardHeader className="border-b-4 border-ink pb-3">
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill label="密码重置" tone="warning" />
              <StatusPill label="邮箱链接验证" tone="neutral" />
            </div>
            <CardTitle>设置新密码</CardTitle>
            <CardDescription>请输入新密码。完成后请返回登录页重新登录。</CardDescription>
          </CardHeader>
          <CardContent>
            {message ? (
              <div className="issue-blue p-4">
                <p className="text-sm font-bold leading-6">{message}</p>
              </div>
            ) : null}

            {error ? (
              <div className="issue-red p-4">
                <p className="text-sm font-bold leading-6">{error}</p>
              </div>
            ) : null}

            {linkState === "checking" ? (
              <div className="flex items-center gap-3 border-4 border-ink bg-secondary p-4 shadow-neo-sm">
                <Loader2 className="animate-spin" size={20} strokeWidth={3} />
                <p className="text-sm font-black uppercase tracking-[0.14em]">
                  正在验证重置链接
                </p>
              </div>
            ) : null}

            {showPasswordForm ? (
              <>
                <div className="grid gap-4">
                  <label className="space-y-2">
                    <span className="text-sm uppercase tracking-[0.14em]">新密码</span>
                    <Input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="请输入至少 6 位新密码"
                      autoComplete="new-password"
                      disabled={submitting}
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="text-sm uppercase tracking-[0.14em]">确认密码</span>
                    <Input
                      type="password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      placeholder="再次输入新密码"
                      autoComplete="new-password"
                      disabled={submitting}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void handleSubmit();
                        }
                      }}
                    />
                  </label>
                </div>

                <Button onClick={() => void handleSubmit()} disabled={submitting} fullWidth>
                  {submitting ? (
                    <Loader2 className="animate-spin" size={18} strokeWidth={3} />
                  ) : (
                    <KeyRound size={18} strokeWidth={3} />
                  )}
                  {submitting ? "提交中..." : "设置新密码"}
                </Button>
              </>
            ) : null}

            {showReturnToLogin ? (
              <Link
                href="/login"
                className="neo-button-base inline-flex h-12 w-full items-center justify-center gap-2 border-4 border-ink bg-secondary px-5 text-sm text-ink shadow-neo-md md:w-auto"
              >
                <span>返回登录</span>
                <ArrowRight size={18} strokeWidth={3} />
              </Link>
            ) : null}
          </CardContent>
        </Card>

        <Card className="bg-muted">
          <CardHeader className="border-b-4 border-ink pb-3">
            <CardTitle>重置说明</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-sm font-bold leading-6">
              <p>必须从邮箱里的重置链接进入本页，系统才会允许设置新密码。</p>
              <p>设置成功后，当前会话会被清理，请使用新密码重新登录。</p>
              <p>如果链接已过期，请回到登录页重新发起找回密码。</p>
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
