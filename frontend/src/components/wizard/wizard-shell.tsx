import { BrutalCard } from "@/components/ui/brutal-card";
import { SectionHeading } from "@/components/ui/section-heading";

export function WizardShell() {
  return (
    <section className="space-y-6">
      <SectionHeading
        title="新手引导"
        description="后续会承接问答式建模、业务上下文采集和规则推荐。"
      />
      <BrutalCard title="Wizard 占位" tone="mint">
        <p className="leading-7">
          本轮只保留页面与状态位置，不提前实现完整对话式向导系统。
        </p>
      </BrutalCard>
    </section>
  );
}

