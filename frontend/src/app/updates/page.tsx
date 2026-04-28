import { AuthGuard } from "@/components/auth/auth-guard";
import { UpdatesPageShell } from "@/components/updates/updates-page-shell";

export default function UpdatesPage() {
  return (
    <AuthGuard>
      <main className="page-shell">
        <UpdatesPageShell />
      </main>
    </AuthGuard>
  );
}
