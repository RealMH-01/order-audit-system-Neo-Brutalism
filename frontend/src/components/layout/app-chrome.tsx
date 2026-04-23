"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";

export function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const immersiveWizard = pathname === "/wizard";

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-canvas text-ink">
      <div className="pointer-events-none absolute inset-0 opacity-30">
        <div className="h-full w-full bg-halftone" />
      </div>
      <div className="relative flex min-h-screen flex-col">
        {!immersiveWizard ? <Navbar /> : null}
        <div className="flex-1">{children}</div>
        {!immersiveWizard ? <Footer /> : null}
      </div>
    </div>
  );
}
