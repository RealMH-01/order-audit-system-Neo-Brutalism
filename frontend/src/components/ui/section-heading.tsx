import type { LucideIcon } from "lucide-react";

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
    <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
      <div>
        <h2 className="text-2xl font-black uppercase">{title}</h2>
        <p className="max-w-2xl text-sm leading-6">{description}</p>
      </div>
      {Icon ? (
        <div className="surface-mint w-fit rounded-full p-3">
          <Icon size={20} strokeWidth={3} />
        </div>
      ) : null}
    </div>
  );
}

