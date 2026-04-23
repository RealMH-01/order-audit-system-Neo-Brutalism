import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva("neo-button-base", {
  variants: {
    variant: {
      primary: "bg-acid text-ink shadow-neo-md hover:bg-secondary",
      secondary: "bg-secondary text-ink shadow-neo-md hover:bg-muted",
      muted: "bg-muted text-ink shadow-neo-md hover:bg-secondary",
      outline: "bg-paper text-ink shadow-neo-sm hover:bg-secondary",
      inverse: "bg-ink text-paper shadow-[8px_8px_0px_0px_#FFFFFF] hover:bg-acid hover:text-ink"
    },
    size: {
      sm: "h-11 px-4 text-xs",
      md: "h-12 px-5 text-sm",
      lg: "h-14 px-6 text-sm"
    },
    fullWidth: {
      true: "w-full",
      false: "w-auto"
    }
  },
  defaultVariants: {
    variant: "primary",
    size: "md",
    fullWidth: false
  }
});

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({
  className,
  variant,
  size,
  fullWidth,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size, fullWidth }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
