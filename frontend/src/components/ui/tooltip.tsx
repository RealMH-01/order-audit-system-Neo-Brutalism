import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type TooltipProps = {
  content: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Tooltip({ content, children, className }: TooltipProps) {
  return (
    <span className={cn("group relative inline-flex", className)}>
      {children}
      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden -translate-x-1/2 group-hover:block group-focus-within:block">
        <span className="neo-tooltip-content whitespace-nowrap">{content}</span>
      </span>
    </span>
  );
}
