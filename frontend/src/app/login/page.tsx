import { AuthPanel } from "@/components/auth/auth-panel";

export default function LoginPage() {
  return (
    <main className="page-shell">
      <AuthPanel
        mode="login"
        title="登录审核系统"
        description="这里已接到当前可用的 auth 接口。登录成功后会按现有系统状态进入向导或审核工作台。"
      />
    </main>
  );
}
