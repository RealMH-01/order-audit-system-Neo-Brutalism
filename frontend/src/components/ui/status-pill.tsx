import { cn } from "@/lib/utils";

type StatusPillProps = {
  label: string;
  tone?: "neutral" | "warning" | "danger" | "success";
};

const toneMap = {
  neutral: "bg-paper",
  warning: "bg-acid",
  danger: "bg-danger text-paper",
  success: "bg-mint"
};

export function StatusPill({
  label,
  tone = "neutral"
}: StatusPillProps) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-full border-4 border-ink px-3 py-1 text-xs uppercase tracking-[0.14em]",
        toneMap[tone]
      )}
    >
      {label}
    </span>
  );
}

