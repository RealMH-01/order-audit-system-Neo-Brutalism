"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, RefreshCcw, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getPublicSystemRules,
  type PublicSystemRuleItem
} from "@/lib/api/system-rules";
import { getStoredAccessToken } from "@/lib/api";
import { cn } from "@/lib/utils";

type LoadStatus = "idle" | "loading" | "success" | "error";

export function PlatformRulesPageShell() {
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [rules, setRules] = useState<PublicSystemRuleItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadRules = useCallback(async (accessToken: string) => {
    setStatus("loading");
    setError(null);

    try {
      const nextRules = await getPublicSystemRules(accessToken);
      setRules(nextRules);
      setStatus("success");
    } catch {
      setRules([]);
      setError("平台规则暂时无法读取，请稍后重试。");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    const accessToken = getStoredAccessToken();
    setToken(accessToken);

    if (!accessToken) {
      setError("请先登录后再查看平台规则。");
      setStatus("error");
      return;
    }

    void loadRules(accessToken);
  }, [loadRules]);

  return (
    <section className="space-y-8">
      <header className="border-4 border-ink bg-paper p-6 shadow-neo-lg md:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-4">
            <Badge variant="secondary" className="-rotate-1">
              只读
            </Badge>
            <div className="space-y-3">
              <h1 className="max-w-4xl text-4xl font-black uppercase leading-none tracking-tight md:text-6xl">
                平台规则
              </h1>
              <p className="max-w-3xl text-base font-bold leading-7 md:text-lg">
                这些规则由平台统一维护，审核时会自动应用。你的自定义规则集会在这些平台规则之外继续生效。
              </p>
            </div>
          </div>
          <Link
            href="/templates"
            className={cn(
              buttonVariants({ variant: "outline" }),
              "inline-flex w-fit items-center gap-2"
            )}
          >
            <ArrowLeft size={18} strokeWidth={3} />
            返回自定义规则集
          </Link>
        </div>
      </header>

      <PlatformRulesContent
        status={status}
        rules={rules}
        error={error}
        onRetry={() => {
          if (token) {
            void loadRules(token);
          }
        }}
      />
    </section>
  );
}

function PlatformRulesContent({
  status,
  rules,
  error,
  onRetry
}: {
  status: LoadStatus;
  rules: PublicSystemRuleItem[];
  error: string | null;
  onRetry: () => void;
}) {
  if (status === "loading" || status === "idle") {
    return (
      <Card className="bg-secondary">
        <CardContent className="flex items-center gap-3 py-8">
          <Loader2 className="animate-spin" size={20} strokeWidth={3} />
          <p className="text-sm font-black uppercase tracking-[0.14em]">
            正在读取平台规则
          </p>
        </CardContent>
      </Card>
    );
  }

  if (status === "error") {
    return (
      <div className="issue-red p-4">
        <p className="text-sm font-black leading-6">
          {error ?? "平台规则暂时无法读取，请稍后重试。"}
        </p>
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-3">
          <RefreshCcw size={16} strokeWidth={3} />
          重新读取
        </Button>
      </div>
    );
  }

  if (rules.length === 0) {
    return (
      <Card className="bg-muted">
        <CardContent className="py-8">
          <p className="text-sm font-black leading-6">
            当前暂无生效的平台规则。
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="inverse">
          <ShieldCheck size={14} strokeWidth={3} />
          自动应用
        </Badge>
        <p className="text-sm font-black leading-6 md:text-base">
          当前生效 {rules.length} 条平台规则
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {rules.map((rule) => (
          <Card key={rule.id} className="bg-secondary">
            <CardHeader>
              <CardTitle className="text-lg md:text-xl">{rule.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap break-words text-sm font-bold leading-6">
                {rule.content}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
