import { AuthPanel } from "@/components/auth/auth-panel";

export default function RegisterPage() {
  return (
    <main className="page-shell">
      <AuthPanel
        mode="register"
        title="注册审核系统"
        description="当前仅搭建注册流页面结构和状态容器，不实现真实注册逻辑。"
      />
    </main>
  );
}

