import { AuthGuard } from "@/components/auth/auth-guard";
import { SettingsShell } from "@/components/shared/settings-shell";

export default function SettingsPage() {
  return (
    <AuthGuard>
      <main className="page-shell">
        <SettingsShell />
      </main>
    </AuthGuard>
  );
}
