import {
  ArrowRight,
  ClipboardCheck,
  FileSearch,
  ShieldCheck,
  Sparkles,
  Workflow
} from "lucide-react";

import { BrutalButton } from "@/components/ui/brutal-button";
import { BrutalCard } from "@/components/ui/brutal-card";

const capabilityCards = [
  {
    title: "单据一致性审核",
    description:
      "围绕 PO、商业发票、装箱单、托书等外贸跟单资料，快速发现字段不一致、缺失和潜在风险。",
    tone: "mint" as const,
    icon: FileSearch
  },
  {
    title: "规则驱动的风险分层",
    description:
      "用 RED、YELLOW、BLUE 分层表达问题严重程度，让跟单、业务和管理者能更快对齐处理优先级。",
    tone: "coral" as const,
    icon: ShieldCheck
  },
  {
    title: "从上传到报告的闭环",
    description:
      "将资料上传、审核启动、过程追踪、结果查看和报告下载串成一条清晰工作流。",
    tone: "sky" as const,
    icon: Workflow
  }
];

const workflowSteps = ["上传 PO 与待审单据", "启动智能审核", "查看风险分层结果", "下载审核报告"];

export default function HomePage() {
  return (
    <main className="page-shell gap-8">
      <section className="surface-paper overflow-hidden rounded-brutal p-6 md:p-8">
        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div className="space-y-6">
            <p className="inline-flex w-fit -rotate-1 items-center gap-2 border-4 border-ink bg-sky px-4 py-2 text-sm font-black uppercase tracking-[0.18em] shadow-neo-sm">
              <Sparkles size={18} strokeWidth={3} />
              外贸单据智能审核
            </p>
            <div className="space-y-4">
              <h1 className="max-w-4xl text-4xl font-black uppercase leading-none tracking-tight md:text-6xl">
                让跟单审核从反复核对，变成清晰可追踪的风险判断。
              </h1>
              <p className="max-w-2xl text-base font-bold leading-7 md:text-lg">
                Order Audit System 面向外贸跟单场景，帮助团队把多份单据中的关键字段、业务规则和风险等级集中到一个可执行的审核流程里。
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <BrutalButton href="/login" icon={ArrowRight}>
                登录开始审核
              </BrutalButton>
              <BrutalButton href="/register" variant="secondary" icon={ClipboardCheck}>
                注册账号
              </BrutalButton>
              <BrutalButton href="/audit" variant="outline" icon={ArrowRight}>
                登录后进入工作台
              </BrutalButton>
            </div>
          </div>

          <div className="relative border-4 border-ink bg-acid p-5 shadow-neo-lg">
            <div className="absolute -right-4 -top-4 h-16 w-16 border-4 border-ink bg-secondary shadow-neo-sm" />
            <div className="relative space-y-4">
              <p className="text-sm font-black uppercase tracking-[0.18em]">Audit Flow</p>
              {workflowSteps.map((step, index) => (
                <div
                  key={step}
                  className="flex items-center gap-3 border-4 border-ink bg-paper p-3 shadow-neo-sm"
                >
                  <span className="inline-flex h-9 w-9 items-center justify-center border-4 border-ink bg-sky text-sm font-black shadow-neo-sm">
                    {index + 1}
                  </span>
                  <p className="font-black">{step}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {capabilityCards.map((item) => {
          const Icon = item.icon;

          return (
            <BrutalCard key={item.title} title={item.title} tone={item.tone}>
              <div className="space-y-4">
                <div className="inline-flex border-4 border-ink bg-paper p-3 shadow-neo-sm">
                  <Icon size={22} strokeWidth={3} />
                </div>
                <p className="text-sm font-bold leading-6">{item.description}</p>
              </div>
            </BrutalCard>
          );
        })}
      </section>

      <section className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="border-4 border-ink bg-secondary p-6 shadow-neo-md">
          <p className="text-sm font-black uppercase tracking-[0.18em]">For Teams</p>
          <h2 className="mt-3 text-3xl font-black uppercase leading-none md:text-4xl">
            更适合多人协作的单据审核入口
          </h2>
        </div>
        <div className="border-4 border-ink bg-paper p-6 shadow-neo-md">
          <p className="text-base font-bold leading-7">
            未登录用户可以先登录或注册，已有账号的用户可以直接进入审核工作台。工作台会自动保护审核数据，只允许登录用户访问。
          </p>
        </div>
      </section>
    </main>
  );
}
