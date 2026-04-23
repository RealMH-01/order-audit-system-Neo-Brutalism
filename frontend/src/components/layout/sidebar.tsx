import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ClipboardCheck, Settings2, Sparkles, Wand2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type SidebarItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

const defaultItems: SidebarItem[] = [
  { href: "/audit", label: "审核工作台", icon: ClipboardCheck },
  { href: "/wizard", label: "AI 引导", icon: Wand2 },
  { href: "/settings", label: "系统设置", icon: Settings2 }
];

type SidebarProps = {
  items?: SidebarItem[];
  className?: string;
};

export function Sidebar({ items = defaultItems, className }: SidebarProps) {
  return (
    <aside
      className={cn(
        "neo-panel sticky top-6 hidden h-fit w-full max-w-xs -rotate-1 p-5 lg:block",
        className
      )}
    >
      <div className="space-y-3 border-b-4 border-ink pb-4">
        <Badge variant="muted">Workspace</Badge>
        <h2 className="text-2xl font-black uppercase leading-none tracking-tight">
          Control Rail
        </h2>
        <p className="text-sm font-bold leading-6">
          这一列是后续业务页可以复用的侧边导航骨架，先统一风格，不提前扩展复杂交互。
        </p>
      </div>

      <nav className="mt-5 space-y-3">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 border-4 border-ink bg-secondary px-4 py-3 font-bold uppercase tracking-[0.14em] shadow-neo-sm transition-all duration-100 ease-linear hover:-translate-y-0.5 hover:bg-acid"
            >
              <span className="inline-flex h-11 w-11 items-center justify-center border-4 border-ink bg-paper shadow-neo-sm">
                <Icon size={18} strokeWidth={3} />
              </span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-5 border-t-4 border-ink pt-4">
        <Badge variant="accent" className="rotate-1">
          <Sparkles size={14} strokeWidth={3} />
          Ready for Next Round
        </Badge>
      </div>
    </aside>
  );
}
