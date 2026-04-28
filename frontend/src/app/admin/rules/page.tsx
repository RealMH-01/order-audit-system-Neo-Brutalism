import { AuthGuard } from "@/components/auth/auth-guard";
import { LegacyRulesNoticeShell } from "@/components/admin/legacy-rules-notice-shell";

export default function AdminRulesPage() {
  return (
    <AuthGuard>
      <main className="page-shell">
        <LegacyRulesNoticeShell />
      </main>
    </AuthGuard>
  );
}
