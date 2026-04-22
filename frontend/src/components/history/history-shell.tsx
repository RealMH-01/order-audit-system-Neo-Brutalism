import { BrutalCard } from "@/components/ui/brutal-card";
import { SectionHeading } from "@/components/ui/section-heading";

export function HistoryShell() {
  return (
    <section className="space-y-6">
      <SectionHeading
        title="历史记录"
        description="后续承接审核记录列表、筛选器和在线查看详情。"
      />
      <BrutalCard title="持久化占位" tone="paper">
        <p className="leading-7">
          本轮仅保留历史页骨架和展示容器，等待后续对接 Supabase 表结构与报告详情接口。
        </p>
      </BrutalCard>
    </section>
  );
}

