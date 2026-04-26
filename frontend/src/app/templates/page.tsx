import { AuthGuard } from "@/components/auth/auth-guard";
import { TemplateLibraryShell } from "@/components/templates/template-library-shell";

export default function TemplatesPage() {
  return (
    <AuthGuard>
      <main className="page-shell">
        <TemplateLibraryShell />
      </main>
    </AuthGuard>
  );
}
