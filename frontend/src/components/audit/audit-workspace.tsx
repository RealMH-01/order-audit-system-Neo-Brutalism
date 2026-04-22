import { FileStack, ScanSearch, TimerReset } from "lucide-react";

import { BrutalCard } from "@/components/ui/brutal-card";
import { SectionHeading } from "@/components/ui/section-heading";
import { StatusPill } from "@/components/ui/status-pill";

const sections = [
  {
    title: "PO 基准区",
    description: "后续放置基准采购订单上传、解析和字段锚点识别。"
  },
  {
    title: "待审核单据区",
    description: "后续放置多文件上传列表、解析状态和文档类型识别。"
  },
  {
    title: "审核结果区",
    description: "后续承接 RED / YELLOW / BLUE 三级问题结果与在线报告。"
  }
];

export function AuditWorkspace() {
  return (
    <section className="space-y-6">
      <SectionHeading
        title="审核工作台"
        description="本轮只对齐目录和模块边界，后续在这里接文件解析、AI 审核编排和 SSE 实时进度。"
        icon={ScanSearch}
      />
      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <BrutalCard title="工作区总览" tone="paper">
          <div className="grid gap-4 md:grid-cols-3">
            {sections.map((section) => (
              <div key={section.title} className="rounded-[1rem] border-4 border-ink bg-sky p-4">
                <h3 className="mb-2 text-base font-black uppercase">{section.title}</h3>
                <p className="text-sm leading-6">{section.description}</p>
              </div>
            ))}
          </div>
        </BrutalCard>
        <BrutalCard title="骨架进度" tone="mint">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <FileStack size={20} strokeWidth={3} />
              <StatusPill label="上传未实现" tone="warning" />
            </div>
            <div className="flex items-center gap-3">
              <TimerReset size={20} strokeWidth={3} />
              <StatusPill label="SSE 已预留" />
            </div>
            <p className="text-sm leading-6">
              当前状态管理和 API 抽象已经迁移到统一目录，后续可以直接挂接审核任务流。
            </p>
          </div>
        </BrutalCard>
      </div>
    </section>
  );
}

