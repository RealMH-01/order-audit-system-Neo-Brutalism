import Link from "next/link";
import { ArrowRight, ShieldCheck, SlidersHorizontal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function LegacyRulesNoticeShell() {
  return (
    <section className="space-y-6">
      <header className="border-4 border-ink bg-paper p-6 shadow-neo-lg md:p-8">
        <div className="space-y-4">
          <Badge variant="muted">Deprecated</Badge>
          <div className="space-y-3">
            <h1 className="max-w-4xl text-4xl font-black uppercase leading-none tracking-tight md:text-6xl">
              此页面已废弃
            </h1>
            <p className="max-w-3xl text-base font-bold leading-7 md:text-lg">
              旧 built-in 规则页面不再作为当前规则维护入口。
            </p>
          </div>
        </div>
      </header>

      <Card className="bg-paper">
        <CardHeader>
          <CardTitle>当前系统只有两类规则</CardTitle>
          <CardDescription>
            请根据维护对象进入对应页面，避免误改旧规则配置。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="border-4 border-ink bg-secondary p-4 shadow-neo-sm">
              <div className="mb-3 flex items-center gap-2">
                <ShieldCheck size={20} strokeWidth={3} />
                <h2 className="text-xl font-black">系统硬规则</h2>
              </div>
              <p className="text-sm font-bold leading-6">
                影响所有用户的新审核，由管理员维护。
              </p>
            </div>
            <div className="border-4 border-ink bg-muted p-4 shadow-neo-sm">
              <div className="mb-3 flex items-center gap-2">
                <SlidersHorizontal size={20} strokeWidth={3} />
                <h2 className="text-xl font-black">自定义规则集</h2>
              </div>
              <p className="text-sm font-bold leading-6">
                用户自己的审核规则集，由用户在审核时选择。
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/admin/system-rules"
              className={cn(buttonVariants({}), "inline-flex items-center gap-2")}
            >
              前往系统硬规则
              <ArrowRight size={18} strokeWidth={3} />
            </Link>
            <Link
              href="/templates"
              className={cn(buttonVariants({ variant: "outline" }), "inline-flex items-center gap-2")}
            >
              前往自定义规则集
              <ArrowRight size={18} strokeWidth={3} />
            </Link>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
