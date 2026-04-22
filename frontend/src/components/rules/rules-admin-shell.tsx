import { BrutalCard } from "@/components/ui/brutal-card";
import { SectionHeading } from "@/components/ui/section-heading";

export function RulesAdminShell() {
  return (
    <section className="space-y-6">
      <SectionHeading
        title="规则管理"
        description="后续承接行业模板、自定义规则和 AI 提示词辅助配置。"
      />
      <BrutalCard title="管理台骨架" tone="paper">
        <p className="leading-7">
          这一轮只建立 `/admin/rules` 路由与管理页面壳层，等待后续接入真实规则数据。
        </p>
      </BrutalCard>
    </section>
  );
}

