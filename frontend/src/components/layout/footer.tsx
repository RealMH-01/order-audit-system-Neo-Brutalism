import Link from "next/link";

import { Badge } from "@/components/ui/badge";

const footerLinks = [
  { href: "/audit", label: "审核" },
  { href: "/wizard", label: "引导" },
  { href: "/settings", label: "设置" }
];

export function Footer() {
  return (
    <footer className="mt-10 border-t-4 border-ink bg-secondary">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 md:px-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-3">
          <Badge variant="inverse">Order Audit System</Badge>
          <p className="max-w-2xl text-sm font-bold leading-6 text-ink">
            当前前端底座已统一到 Neo-Brutalism 设计系统：粗黑边框、硬阴影、强对比色块、快速机械交互。
          </p>
        </div>
        <nav className="flex flex-wrap gap-3">
          {footerLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="inline-flex items-center border-4 border-ink bg-paper px-4 py-2 text-sm font-bold uppercase tracking-[0.14em] shadow-neo-sm transition-all duration-100 ease-linear hover:-translate-y-0.5 hover:bg-acid"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
