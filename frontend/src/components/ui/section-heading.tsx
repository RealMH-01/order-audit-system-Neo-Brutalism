import type { LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";

type SectionHeadingProps = {
  title: string;
  description: string;
  icon?: LucideIcon;
};

export function SectionHeading({
  title,
  description,
  icon: Icon
}: SectionHeadingProps) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="space-y-3">
        <Badge variant="secondary" className="rotate-[-1deg]">
          Section
        </Badge>
        <div className="space-y-2">
          <h2 className="text-3xl font-black uppercase leading-none tracking-tight md:text-4xl">
            {title}
          </h2>
          <p className="max-w-2xl text-sm font-bold leading-6 md:text-base">
            {description}
          </p>
        </div>
      </div>
      {Icon ? (
        <div className="inline-flex w-fit rotate-3 border-4 border-ink bg-acid p-3 shadow-neo-md">
          <Icon size={20} strokeWidth={3} />
        </div>
      ) : null}
    </div>
  );
}
