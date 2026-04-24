import { AuthGuard } from "@/components/auth/auth-guard";
import { AuditWorkspace } from "@/components/audit/audit-workspace";

export default function AuditPage() {
  return (
    <AuthGuard>
      <main className="page-shell">
        <AuditWorkspace />
      </main>
    </AuthGuard>
  );
}
