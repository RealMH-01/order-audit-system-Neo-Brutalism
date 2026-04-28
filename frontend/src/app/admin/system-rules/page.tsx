import { AuthGuard } from "@/components/auth/auth-guard";
import { SystemRulesAdminShell } from "@/components/admin/system-rules-admin-shell";

export default function AdminSystemRulesPage() {
  return (
    <AuthGuard>
      <main className="page-shell">
        <SystemRulesAdminShell />
      </main>
    </AuthGuard>
  );
}
