import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type BrutalButtonProps = {
  children: ReactNode;
  href?: string;
  icon?: LucideIcon;
  variant?: "primary" | "secondary" | "muted" | "outline";
  className?: string;
};

export function BrutalButton({
  children,
  href,
  icon: Icon,
  variant = "primary",
  className
}: BrutalButtonProps) {
  const content = (
    <>
      <span>{children}</span>
      {Icon ? <Icon size={18} strokeWidth={3} /> : null}
    </>
  );

  const classes = cn(buttonVariants({ variant, size: "md" }), className);

  if (href) {
    return (
      <Link href={href} className={classes}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" className={classes}>
      {content}
    </button>
  );
}
