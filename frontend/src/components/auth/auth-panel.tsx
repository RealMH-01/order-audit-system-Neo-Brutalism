import { BrutalButton } from "@/components/ui/brutal-button";
import { BrutalCard } from "@/components/ui/brutal-card";
import { Input } from "@/components/ui/input";
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
              <span className="text-sm uppercase tracking-[0.14em]">邮箱</span>
              <Input placeholder="name@example.com" />
            </label>
            <label className="space-y-2">
              <span className="text-sm uppercase tracking-[0.14em]">密码</span>
              <Input type="password" placeholder="请输入密码" />
            </label>
          </div>
          <BrutalButton>{mode === "login" ? "登录" : "注册"}</BrutalButton>
        </div>
      </BrutalCard>
      <BrutalCard title="认证骨架状态" tone="sky">
        <div className="space-y-3 text-sm leading-6">
          <StatusPill label="Skeleton Only" tone="warning" />
          <p>页面结构、基础输入组件和 API 承接位已经就绪，方便后续接入真实认证链路。</p>
          <p>真实 Supabase 注册、登录、会话刷新和权限控制仍会在后续轮次继续接入。</p>
        </div>
      </BrutalCard>
    </section>
  );
}
