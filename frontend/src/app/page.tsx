import { ArrowRight, ClipboardCheck, FolderKanban, Sparkles } from "lucide-react";

import { BrutalButton } from "@/components/ui/brutal-button";
import { BrutalCard } from "@/components/ui/brutal-card";
import { SectionHeading } from "@/components/ui/section-heading";

const navigationCards = [
  {
    title: "登录",
    description: "基础认证页骨架和状态容器入口。",
    href: "/login",
    tone: "paper" as const
  },
  {
    title: "注册",
    description: "注册页面骨架与后续接入位。",
    href: "/register",
    tone: "sky" as const
  },
  {
    title: "审核工作台",
    description: "PO 基准、待审单据和结果区域骨架。",
    href: "/audit",
    tone: "mint" as const
  },
  {
    title: "历史记录",
    description: "审核历史和在线查看的后续入口。",
    href: "/history",
    tone: "paper" as const
  },
  {
    title: "系统设置",
    description: "模型平台、规则偏好和 API Key 承接页。",
    href: "/settings",
    tone: "coral" as const
  },
  {
    title: "新手引导",
    description: "Wizard 问答式流程的页面壳层。",
    href: "/wizard",
    tone: "sky" as const
  },
  {
    title: "规则管理",
    description: "行业模板和规则管理后台入口。",
    href: "/admin/rules",
    tone: "mint" as const
  }
];

const highlights = [
  {
    title: "PO 作为审核基准",
    description: "为后续商业发票、装箱单和托书建立统一校验锚点。"
  },
  {
    title: "多模型能力预留",
    description: "预留 OpenAI、DeepSeek 和智谱 GLM 的接入位。"
  },
  {
    title: "新手到专业双模式",
    description: "后续可同时支撑 wizard 引导流与专业审核工作台。"
  }
];

export default function HomePage() {
  return (
    <main className="page-shell gap-8">
      <section className="surface-paper rounded-brutal p-6 md:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-4">
            <p className="inline-flex w-fit items-center gap-2 rounded-full border-4 border-ink bg-sky px-4 py-2 text-sm uppercase tracking-[0.18em]">
              <Sparkles size={18} strokeWidth={3} />
              Round 2 Structure Alignment
            </p>
            <h1 className="text-4xl font-black uppercase leading-none md:text-6xl">
              Order Audit System
              <span className="block text-acid">Neo-Brutalism</span>
            </h1>
            <p className="max-w-2xl text-base leading-7 md:text-lg">
              这一轮重点是把目录结构、模块边界和导入路径统一到稳定的工程层次，为后续业务开发铺路。
            </p>
          </div>
          <BrutalButton href="/audit" icon={ArrowRight}>
            进入审核工作台
          </BrutalButton>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {highlights.map((item) => (
          <BrutalCard key={item.title} title={item.title} tone="mint">
            <p className="text-sm leading-6">{item.description}</p>
          </BrutalCard>
        ))}
      </section>

      <section className="space-y-4">
        <SectionHeading
          title="基础路由"
          description="下面这些页面都已经迁移到 frontend/src/app，并保留清晰的扩展入口。"
          icon={FolderKanban}
        />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {navigationCards.map((item) => (
            <BrutalCard key={item.href} title={item.title} tone={item.tone}>
              <p className="mb-4 text-sm leading-6">{item.description}</p>
              <BrutalButton href={item.href} variant="secondary" icon={ClipboardCheck}>
                打开页面
              </BrutalButton>
            </BrutalCard>
          ))}
        </div>
      </section>
    </main>
  );
}

