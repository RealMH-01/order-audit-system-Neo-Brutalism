"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, LogIn, UserPlus } from "lucide-react";

import type { WizardAuthResponse, WizardProfile } from "@/components/wizard/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";
import type { MessageResponse } from "@/types";
import {
  apiGet,
  apiPost,
  clearStoredAccessToken,
  getStoredAccessToken,
  popStoredAuthNotice,
  setStoredAccessToken
} from "@/lib/api";
import { normalizeApiErrorDetail } from "@/lib/api-error";

type AuthPanelProps = {
  mode: "login" | "register";
  title: string;
  description: string;
};

type AuthFormState = {
  displayName: string;
  email: string;
  password: string;
};

const initialFormState: AuthFormState = {
  displayName: "",
  email: "",
  password: ""
};

const PASSWORD_RESET_SENT_MESSAGE =
  "如果该邮箱已注册，我们会发送密码重置邮件。请检查收件箱和垃圾邮件。";
const REGISTER_EMAIL_HELPER_TEXT =
  "请使用可以正常接收邮件的邮箱注册。后续找回或重置密码时，需要通过该邮箱接收重置链接完成验证。";

function normalizeError(error: unknown, fallback: string) {
  return normalizeApiErrorDetail(error, fallback);
}

function validateEmail(email: string) {
  return /\S+@\S+\.\S+/.test(email);
}

async function resolvePostAuthDestination(token: string) {
  await apiGet("/auth/me", { token });
  const { data } = await apiGet<WizardProfile>("/settings/profile", { token });
  return data.wizard_completed ? "/audit" : "/wizard";
}

export function AuthPanel({ mode, title, description }: AuthPanelProps) {
  const router = useRouter();
  const [form, setForm] = useState<AuthFormState>(initialFormState);
  const [checkingSession, setCheckingSession] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [passwordResetMode, setPasswordResetMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const isRegister = mode === "register";
  const isPasswordResetMode = !isRegister && passwordResetMode;
  const alternateHref = isRegister ? "/login" : "/register";
  const alternateLabel = isRegister ? "已有账号，去登录" : "没有账号，去注册";
  const submitLabel = isRegister
    ? "注册并进入系统"
    : isPasswordResetMode
      ? "发送重置邮件"
      : "登录并进入系统";

  const validationMessage = useMemo(() => {
    if (isRegister && !form.displayName.trim()) {
      return "请输入显示名称。";
    }
    if (!form.email.trim()) {
      return "请输入邮箱地址。";
    }
    if (!validateEmail(form.email.trim())) {
      return "请输入有效邮箱地址。";
    }
    if (isPasswordResetMode) {
      return null;
    }
    if (!form.password.trim()) {
      return "请输入密码。";
    }
    if (form.password.trim().length < 6) {
      return "密码至少需要 6 位。";
    }
    return null;
  }, [form.displayName, form.email, form.password, isPasswordResetMode, isRegister]);

  const updateField = useCallback(
    <K extends keyof AuthFormState>(field: K, value: AuthFormState[K]) => {
      setForm((previous) => ({ ...previous, [field]: value }));
    },
    []
  );

  const finalizeAuthSuccess = useCallback(
    async (token: string, successMessage: string) => {
      setStoredAccessToken(token);
      setMessage(successMessage);
      const destination = await resolvePostAuthDestination(token);
      router.replace(destination);
    },
    [router]
  );

  const handleSubmit = useCallback(async () => {
    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    setSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      if (isPasswordResetMode) {
        await apiPost<MessageResponse>("/auth/password-reset/request", {
          email: form.email.trim()
        });
        setMessage(PASSWORD_RESET_SENT_MESSAGE);
      } else if (isRegister) {
        const { data } = await apiPost<WizardAuthResponse>("/auth/register", {
          email: form.email.trim(),
          password: form.password.trim(),
          display_name: form.displayName.trim()
        });
        await finalizeAuthSuccess(data.access_token, "注册成功，正在进入系统...");
      } else {
        const { data } = await apiPost<WizardAuthResponse>("/auth/login", {
          email: form.email.trim(),
          password: form.password.trim()
        });
        await finalizeAuthSuccess(data.access_token, "登录成功，正在进入系统...");
      }
    } catch (submitError) {
      clearStoredAccessToken();
      setError(
        normalizeError(
          submitError,
          isPasswordResetMode
            ? "密码重置邮件暂时无法发送，请稍后重试。"
            : isRegister
              ? "注册失败，请稍后重试。"
              : "登录失败，请检查邮箱和密码后重试。"
        )
      );
    } finally {
      setSubmitting(false);
    }
  }, [
    finalizeAuthSuccess,
    form.displayName,
    form.email,
    form.password,
    isPasswordResetMode,
    isRegister,
    validationMessage
  ]);

  useEffect(() => {
    const token = getStoredAccessToken();
    if (!token) {
      if (!isRegister) {
        setError(popStoredAuthNotice());
      }
      setCheckingSession(false);
      return;
    }

    void (async () => {
      try {
        const destination = await resolvePostAuthDestination(token);
        router.replace(destination);
      } catch {
        clearStoredAccessToken();
        if (!isRegister) {
          setError(popStoredAuthNotice());
        }
      } finally {
        setCheckingSession(false);
      }
    })();
  }, [isRegister, router]);

  if (checkingSession) {
    return (
      <section className="mx-auto grid w-full max-w-5xl gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="bg-paper lg:col-span-2">
          <CardContent className="flex items-center gap-3 py-10">
            <Loader2 className="animate-spin" size={20} strokeWidth={3} />
            <p className="text-sm font-bold uppercase tracking-[0.14em]">
              正在检查当前登录状态
            </p>
          </CardContent>
        </Card>
      </section>
    );
  }

  const SubmitIcon = isRegister ? UserPlus : LogIn;

  return (
    <section className="mx-auto grid w-full max-w-5xl gap-6 lg:grid-cols-[1.2fr_0.8fr]">
      <Card className="bg-paper">
        <CardHeader className="border-b-4 border-ink pb-3">
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill
              label={isRegister ? "注册入口" : isPasswordResetMode ? "找回密码" : "登录入口"}
              tone={isRegister ? "success" : "warning"}
            />
            <StatusPill label="账号服务已连接" tone="neutral" />
          </div>
          <CardTitle>{isPasswordResetMode ? "找回密码" : title}</CardTitle>
          <CardDescription>
            {isPasswordResetMode
              ? "输入你的注册邮箱。如果该邮箱已注册，我们会发送密码重置邮件。"
              : description}
          </CardDescription>
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

          <div className="grid gap-4 md:grid-cols-2">
            {isRegister ? (
              <label className="space-y-2 md:col-span-2">
                <span className="text-sm uppercase tracking-[0.14em]">账号昵称</span>
                <Input
                  value={form.displayName}
                  onChange={(event) => updateField("displayName", event.target.value)}
                  placeholder="例如：订单审核组 / 张三 / 业务审核团队"
                  disabled={submitting}
                />
                <p className="text-xs font-bold leading-5">
                  注册后会显示在导航栏，也可在设置页修改。
                </p>
              </label>
            ) : null}

            <label className={isRegister || isPasswordResetMode ? "space-y-2 md:col-span-2" : "space-y-2"}>
              <span className="text-sm uppercase tracking-[0.14em]">邮箱</span>
              <Input
                value={form.email}
                onChange={(event) => updateField("email", event.target.value)}
                placeholder="name@example.com"
                autoComplete="email"
                disabled={submitting}
                onKeyDown={(event) => {
                  if (isPasswordResetMode && event.key === "Enter") {
                    event.preventDefault();
                    void handleSubmit();
                  }
                }}
              />
              {isRegister ? (
                <p className="border-4 border-ink bg-secondary px-3 py-2 text-xs font-black leading-5 shadow-neo-sm">
                  {REGISTER_EMAIL_HELPER_TEXT}
                </p>
              ) : null}
            </label>

            {isPasswordResetMode ? null : (
              <label className="space-y-2">
                <span className="text-sm uppercase tracking-[0.14em]">密码</span>
                <Input
                  type="password"
                  value={form.password}
                  onChange={(event) => updateField("password", event.target.value)}
                  placeholder="请输入至少 6 位密码"
                  autoComplete={isRegister ? "new-password" : "current-password"}
                  disabled={submitting}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleSubmit();
                    }
                  }}
                />
              </label>
            )}
          </div>

          {!isRegister ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                className="border-b-4 border-ink text-sm font-black uppercase tracking-[0.14em] hover:text-acid"
                disabled={submitting}
                onClick={() => {
                  setPasswordResetMode((current) => !current);
                  setError(null);
                  setMessage(null);
                }}
              >
                {isPasswordResetMode ? "返回登录" : "忘记密码？"}
              </button>
              {isPasswordResetMode ? (
                <p className="max-w-md text-xs font-bold leading-5">
                  输入你的注册邮箱。如果该邮箱已注册，我们会发送密码重置邮件。
                </p>
              ) : null}
            </div>
          ) : null}

          <Button onClick={() => void handleSubmit()} disabled={submitting} fullWidth>
            {submitting ? (
              <Loader2 className="animate-spin" size={18} strokeWidth={3} />
            ) : (
              <SubmitIcon size={18} strokeWidth={3} />
            )}
            {submitting ? "提交中..." : submitLabel}
          </Button>
        </CardContent>
      </Card>

      <Card className="bg-muted">
        <CardHeader className="border-b-4 border-ink pb-3">
          <CardTitle>{isRegister ? "注册后会发生什么" : "登录后会发生什么"}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm font-bold leading-6">
            {isRegister ? (
              <>
                <p>注册成功后，系统会自动创建你的个人配置。</p>
                <p>首次使用时会进入引导向导，帮助你完成模型、规则和公司信息配置。</p>
                <p>后续登录时，系统会自动使用你保存过的配置。</p>
              </>
            ) : (
              <>
                <p>登录成功后，系统会自动读取你已保存的模型、规则和密钥配置。</p>
                <p>如果你是首次使用，系统会引导你完成基础配置；如果已经配置完成，会直接进入审核工作台。</p>
                <p>使用审核功能前，需要先阅读并确认使用须知。</p>
              </>
            )}
          </div>

          <Link
            href={alternateHref}
            className="neo-button-base mt-2 inline-flex h-12 w-full items-center justify-center gap-2 border-4 border-ink bg-secondary px-5 text-sm text-ink shadow-neo-md md:w-auto"
          >
            <span>{alternateLabel}</span>
            <ArrowRight size={18} strokeWidth={3} />
          </Link>
        </CardContent>
      </Card>
    </section>
  );
}
