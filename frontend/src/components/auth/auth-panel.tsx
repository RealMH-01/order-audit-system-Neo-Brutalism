import { BrutalButton } from "@/components/ui/brutal-button";
import { BrutalCard } from "@/components/ui/brutal-card";
import { StatusPill } from "@/components/ui/status-pill";

type AuthPanelProps = {
  mode: "login" | "register";
  title: string;
  description: string;
};

export function AuthPanel({ mode, title, description }: AuthPanelProps) {
  return (
    <section className="mx-auto grid w-full max-w-5xl gap-6 lg:grid-cols-[1.2fr_0.8fr]">
      <BrutalCard title={title} tone="paper">
        <div className="space-y-4">
          <p className="max-w-xl leading-7">{description}</p>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm uppercase">邮箱</span>
              <input className="w-full rounded-[1rem] border-4 border-ink bg-paper px-4 py-3" />
            </label>
            <label className="space-y-2">
              <span className="text-sm uppercase">密码</span>
              <input
                type="password"
                className="w-full rounded-[1rem] border-4 border-ink bg-paper px-4 py-3"
              />
            </label>
          </div>
          <BrutalButton>{mode === "login" ? "登录" : "注册"}</BrutalButton>
        </div>
      </BrutalCard>
      <BrutalCard title="认证骨架状态" tone="sky">
        <div className="space-y-3 text-sm leading-6">
          <StatusPill label="Skeleton Only" tone="warning" />
          <p>状态容器、页面路由和 API 抽象已经就位。</p>
          <p>真实 Supabase 注册、登录、会话刷新和权限控制将在后续轮次接入。</p>
        </div>
      </BrutalCard>
    </section>
  );
}

