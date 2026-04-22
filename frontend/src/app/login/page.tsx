import { AuthPanel } from "@/components/auth/auth-panel";

export default function LoginPage() {
  return (
    <main className="page-shell">
      <AuthPanel
        mode="login"
        title="登录审核系统"
        description="Supabase Auth 的实际接入会在后续轮次补齐，这里先保留完整页面骨架。"
      />
    </main>
  );
}

