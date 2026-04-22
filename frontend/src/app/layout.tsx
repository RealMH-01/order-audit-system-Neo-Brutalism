import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import type { ReactNode } from "react";

import "@/styles/globals.css";

import { AppProviders } from "@/components/layout/app-providers";

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
      <body className={`${spaceGrotesk.variable} brutal-grid`}>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}

