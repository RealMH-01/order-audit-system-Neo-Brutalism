import { AuthGuard } from "@/components/auth/auth-guard";
import { HistoryShell } from "@/components/history/history-shell";

export default function HistoryPage() {
  return (
    <AuthGuard>
      <main className="page-shell">
        <HistoryShell />
      </main>
    </AuthGuard>
  );
}
