"use client";

import type { ReactNode } from "react";

import { AuthProvider } from "@/lib/auth-context";
import { AuditProvider } from "@/lib/audit-context";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <AuditProvider>{children}</AuditProvider>
    </AuthProvider>
  );
}

