import { AuthGuard } from "@/components/auth/auth-guard";
import { PlatformRulesPageShell } from "@/components/platform-rules/platform-rules-page-shell";

export default function PlatformRulesPage() {
  return (
    <AuthGuard>
      <main className="page-shell">
        <PlatformRulesPageShell />
      </main>
    </AuthGuard>
  );
}
