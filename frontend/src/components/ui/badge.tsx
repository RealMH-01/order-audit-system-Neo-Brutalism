import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva("neo-badge-base", {
  variants: {
    variant: {
      neutral: "bg-paper text-ink",
      accent: "bg-acid text-ink",
      secondary: "bg-secondary text-ink",
      muted: "bg-muted text-ink",
      inverse: "bg-ink text-paper"
    }
  },
  defaultVariants: {
    variant: "neutral"
  }
});

type BadgeProps = HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
