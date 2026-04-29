import { AuthGuard } from "@/components/auth/auth-guard";
import { ArchivedRulesNoticeShell } from "@/components/admin/archived-rules-notice-shell";

export default function AdminRulesPage() {
  return (
    <AuthGuard>
      <main className="page-shell">
        <ArchivedRulesNoticeShell />
      </main>
    </AuthGuard>
  );
}
