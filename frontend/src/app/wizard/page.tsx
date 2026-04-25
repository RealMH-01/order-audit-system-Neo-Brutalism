"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { WizardShell } from "@/components/wizard/wizard-shell";
import { getStoredAccessToken } from "@/lib/api";

export default function WizardPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    const accessToken = getStoredAccessToken();
    if (!accessToken) {
      router.replace("/login");
      return;
    }

    setAuthorized(true);
  }, [router]);

  if (!authorized) {
    return null;
  }

  return <WizardShell />;
}
