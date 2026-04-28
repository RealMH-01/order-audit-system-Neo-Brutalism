"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Loader2, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getPublicSystemRules,
  type PublicSystemRuleItem
} from "@/lib/api/system-rules";

type LoadStatus = "idle" | "loading" | "success" | "error";

export function SystemRulesReadonlyPanel({ token }: { token: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [rules, setRules] = useState<PublicSystemRuleItem[]>([]);

  const loadRules = async () => {
    if (!token) {
      setStatus("error");
      return;
    }

    setStatus("loading");

    try {
      const nextRules = await getPublicSystemRules(token);
      setRules(nextRules);
      setStatus("success");
    } catch {
      setRules([]);
      setStatus("error");
    }
  };

  const toggleExpanded = () => {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);

    if (nextExpanded && (status === "idle" || status === "error")) {
      void loadRules();
    }
  };

  return (
    <section className="border-4 border-ink bg-paper p-5 shadow-neo-md">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="inverse">
              <ShieldCheck size={14} strokeWidth={3} />
              只读
            </Badge>
            <h2 className="text-2xl font-black uppercase leading-none tracking-tight md:text-3xl">
              当前生效的系统硬规则
            </h2>
          </div>
          <p className="max-w-4xl text-sm font-bold leading-6 md:text-base">
            这些规则由平台统一维护，会自动应用到所有新审核。你不能修改它们；你可以在下方维护自己的自定义规则集。
          </p>
        </div>

        <Button
          variant="outline"
          onClick={toggleExpanded}
          aria-expanded={expanded}
          className="w-fit"
        >
          {expanded ? (
            <ChevronUp size={18} strokeWidth={3} />
          ) : (
            <ChevronDown size={18} strokeWidth={3} />
          )}
          {expanded ? "收起" : "展开查看"}
        </Button>
      </div>

      {expanded ? (
        <div className="mt-5">
          <SystemRulesContent status={status} rules={rules} />
        </div>
      ) : null}
    </section>
  );
}

function SystemRulesContent({
  status,
  rules
}: {
  status: LoadStatus;
  rules: PublicSystemRuleItem[];
}) {
  if (status === "loading" || status === "idle") {
    return (
      <Card className="bg-secondary">
        <CardContent className="flex items-center gap-3 py-8">
          <Loader2 className="animate-spin" size={20} strokeWidth={3} />
          <p className="text-sm font-black uppercase tracking-[0.14em]">
            正在读取系统硬规则
          </p>
        </CardContent>
      </Card>
    );
  }

  if (status === "error") {
    return (
      <div className="issue-red p-4">
        <p className="text-sm font-black leading-6">
          系统硬规则暂时无法读取，不影响你管理自定义规则集。
        </p>
      </div>
    );
  }

  if (rules.length === 0) {
    return (
      <Card className="bg-muted">
        <CardContent className="py-8">
          <p className="text-sm font-black leading-6">
            当前暂无启用的系统硬规则。
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
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
  );
}
