import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type BrutalButtonProps = {
  children: ReactNode;
  href?: string;
  icon?: LucideIcon;
  variant?: "primary" | "secondary";
  className?: string;
};

const baseClassName =
  "inline-flex items-center justify-center gap-2 rounded-[1rem] border-4 border-ink px-5 py-3 text-sm uppercase tracking-[0.14em] transition-transform duration-150 hover:-translate-y-1";

const variants = {
  primary: "bg-ink text-paper shadow-brutal",
  secondary: "bg-paper text-ink shadow-brutal-sm"
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

  const classes = cn(baseClassName, variants[variant], className);

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

