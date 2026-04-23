import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type ProgressProps = HTMLAttributes<HTMLDivElement> & {
  value?: number;
};

export function Progress({
  className,
  value = 0,
  ...props
}: ProgressProps) {
  const safeValue = Math.max(0, Math.min(100, value));

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={safeValue}
      className={cn("neo-progress-track", className)}
      {...props}
    >
      <div
        className="neo-progress-indicator"
        style={{ width: `${safeValue}%` }}
      />
    </div>
  );
}
