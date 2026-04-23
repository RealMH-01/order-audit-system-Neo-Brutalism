import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

import type { WizardStepKey } from "@/components/wizard/types";

type StepIndicatorProps = {
  steps: Array<{ key: WizardStepKey; label: string }>;
  currentStep: number;
  onJump: (index: number) => void;
};

export function StepIndicator({
  steps,
  currentStep,
  onJump
}: StepIndicatorProps) {
  return (
    <div className="neo-panel-secondary p-4 md:p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        {steps.map((step, index) => {
          const active = index === currentStep;
          const completed = index < currentStep;

          return (
            <button
              key={step.key}
              type="button"
              onClick={() => onJump(index)}
              className={cn(
                "flex flex-1 items-center gap-3 border-4 border-ink px-4 py-3 text-left font-bold uppercase tracking-[0.14em] transition-all duration-100 ease-linear",
                active
                  ? "bg-acid shadow-neo-md"
                  : completed
                    ? "bg-paper shadow-neo-sm hover:-translate-y-0.5"
                    : "bg-canvas shadow-neo-sm hover:bg-paper"
              )}
            >
              <span
                className={cn(
                  "inline-flex h-10 w-10 items-center justify-center border-4 border-ink text-sm font-black shadow-neo-sm",
                  active ? "bg-secondary" : completed ? "bg-muted" : "bg-paper"
                )}
              >
                {completed ? <Check size={18} strokeWidth={3} /> : index + 1}
              </span>
              <span className="text-xs md:text-sm">{step.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
