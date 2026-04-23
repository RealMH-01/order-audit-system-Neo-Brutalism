import type { ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type BrutalCardProps = {
  title: string;
  children: ReactNode;
  tone?: "paper" | "mint" | "coral" | "sky" | "muted";
};

const toneMap = {
  paper: "bg-paper",
  mint: "bg-secondary",
  coral: "bg-acid",
  sky: "bg-muted",
  muted: "bg-muted"
};

export function BrutalCard({
  title,
  children,
  tone = "paper"
}: BrutalCardProps) {
  return (
    <Card className={cn(toneMap[tone])}>
      <CardHeader className="border-b-4 border-ink pb-3">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
