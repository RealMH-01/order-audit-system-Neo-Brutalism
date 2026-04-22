import { BrutalCard } from "@/components/ui/brutal-card";
import { SectionHeading } from "@/components/ui/section-heading";
import { StatusPill } from "@/components/ui/status-pill";

export function SettingsShell() {
  return (
    <section className="space-y-6">
      <SectionHeading
        title="系统设置"
        description="用于承接 API Key、模型平台切换、行业模板和偏好设置。"
      />
      <div className="grid gap-4 md:grid-cols-2">
        <BrutalCard title="模型平台" tone="paper">
          <div className="space-y-3">
            <StatusPill label="DeepSeek + GLM + OpenAI" />
            <p className="text-sm leading-6">
              前端模型矩阵会在后续轮次接入，这一轮先建立承载结构。
            </p>
          </div>
        </BrutalCard>
        <BrutalCard title="规则与偏好" tone="coral">
          <p className="text-sm leading-6">
            后续会在这里接入行业模板、深度思考开关提示和个人审核习惯配置。
          </p>
        </BrutalCard>
      </div>
    </section>
  );
}

