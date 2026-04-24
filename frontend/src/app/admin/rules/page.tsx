import { AuthGuard } from "@/components/auth/auth-guard";
import { RulesAdminShell } from "@/components/rules/rules-admin-shell";

export default function AdminRulesPage() {
  return (
    <AuthGuard>
      <main className="page-shell">
        <RulesAdminShell />
      </main>
    </AuthGuard>
  );
}
