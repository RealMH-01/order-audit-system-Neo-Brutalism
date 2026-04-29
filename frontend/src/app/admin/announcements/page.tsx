import { AnnouncementsAdminShell } from "@/components/admin/announcements-admin-shell";
import { AuthGuard } from "@/components/auth/auth-guard";

export default function AdminAnnouncementsPage() {
  return (
    <AuthGuard>
      <main className="page-shell">
        <AnnouncementsAdminShell />
      </main>
    </AuthGuard>
  );
}
