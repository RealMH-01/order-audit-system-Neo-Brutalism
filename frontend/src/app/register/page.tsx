import { AuthPanel } from "@/components/auth/auth-panel";

export default function RegisterPage() {
  return (
    <main className="page-shell">
      <AuthPanel
        mode="register"
        title="注册审核系统"
        description="注册成功后会直接写入当前 auth 会话，并按现有 profile 状态进入向导或审核工作台。"
      />
    </main>
  );
}
