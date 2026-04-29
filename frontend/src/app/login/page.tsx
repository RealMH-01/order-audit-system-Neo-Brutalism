import { AuthPanel } from "@/components/auth/auth-panel";

export default function LoginPage() {
  return (
    <main className="page-shell">
      <AuthPanel
        mode="login"
        title="登录审核系统"
        description="登录成功后会根据你的配置情况，进入配置引导或审核工作台。"
      />
    </main>
  );
}
