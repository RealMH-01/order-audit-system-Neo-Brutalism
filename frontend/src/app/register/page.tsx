import { AuthPanel } from "@/components/auth/auth-panel";

export default function RegisterPage() {
  return (
    <main className="page-shell">
      <AuthPanel
        mode="register"
        title="注册审核系统"
        description="注册成功后会自动创建账号配置，并引导你完成审核所需信息。"
      />
    </main>
  );
}
