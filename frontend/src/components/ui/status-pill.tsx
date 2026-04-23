import { Badge } from "@/components/ui/badge";

type StatusPillProps = {
  label: string;
  tone?: "neutral" | "warning" | "danger" | "success";
};

const toneMap = {
  neutral: "neutral",
  warning: "accent",
  danger: "inverse",
  success: "secondary"
} as const;

export function StatusPill({
  label,
  tone = "neutral"
}: StatusPillProps) {
  return <Badge variant={toneMap[tone]}>{label}</Badge>;
}
