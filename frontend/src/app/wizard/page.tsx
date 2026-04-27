import { AuthGuard } from "@/components/auth/auth-guard";
import { WizardShell } from "@/components/wizard/wizard-shell";

export default function WizardPage() {
  return (
    <AuthGuard>
      <WizardShell />
    </AuthGuard>
  );
}
