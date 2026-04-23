import { X } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DialogProps = {
  open: boolean;
  onClose?: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer
}: DialogProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="关闭弹窗"
        className="neo-dialog-overlay"
        onClick={onClose}
      />
      <div className="neo-dialog-panel">
        <div className="mb-5 flex items-start justify-between gap-4 border-b-4 border-ink pb-4">
          <div className="space-y-2">
            {title ? (
              <h2 className="text-2xl font-black uppercase tracking-tight">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className="text-sm font-bold leading-6">{description}</p>
            ) : null}
          </div>
          {onClose ? (
            <Button
              aria-label="关闭弹窗"
              variant="secondary"
              size="sm"
              onClick={onClose}
              className="min-w-[3rem] px-3"
            >
              <X size={18} strokeWidth={3} />
            </Button>
          ) : null}
        </div>
        <div className="space-y-4">{children}</div>
        {footer ? <div className="mt-6 flex flex-wrap gap-3">{footer}</div> : null}
      </div>
    </div>
  );
}

export function DialogSection({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-3", className)} {...props} />;
}
