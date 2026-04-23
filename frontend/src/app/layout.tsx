import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import type { ReactNode } from "react";

import "@/styles/globals.css";

import { AppProviders } from "@/components/layout/app-providers";
import { Footer } from "@/components/layout/footer";
import { Navbar } from "@/components/layout/navbar";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: "variable",
  variable: "--font-space-grotesk",
  display: "swap"
});

export const metadata: Metadata = {
  title: "Order Audit System",
  description: "Neo-Brutalism AI-assisted document audit workspace"
};

export default function RootLayout({
  children
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className={`${spaceGrotesk.variable} bg-grid-pattern`}>
        <AppProviders>
          <div className="relative min-h-screen overflow-x-hidden bg-canvas text-ink">
            <div className="pointer-events-none absolute inset-0 opacity-30">
              <div className="h-full w-full bg-halftone" />
            </div>
            <div className="relative flex min-h-screen flex-col">
              <Navbar />
              <div className="flex-1">{children}</div>
              <Footer />
            </div>
          </div>
        </AppProviders>
      </body>
    </html>
  );
}
