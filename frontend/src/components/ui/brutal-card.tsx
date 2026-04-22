import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type BrutalCardProps = {
  title: string;
  children: ReactNode;
  tone?: "paper" | "mint" | "coral" | "sky";
};

const toneMap = {
  paper: "bg-paper",
  mint: "bg-mint",
  coral: "bg-coral",
  sky: "bg-sky"
};

export function BrutalCard({
  title,
  children,
  tone = "paper"
}: BrutalCardProps) {
  return (
    <article
      className={cn(
        "rounded-brutal border-4 border-ink p-5 shadow-brutal-sm",
        toneMap[tone]
      )}
    >
      <h2 className="mb-3 text-xl font-black uppercase">{title}</h2>
      {children}
    </article>
  );
}

