"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth-context";

const footerLinks = [
  { href: "/audit", label: "审核" },
  { href: "/wizard", label: "引导" },
  { href: "/settings", label: "设置" }
];

const guestFooterLinks = [
  { href: "/", label: "首页" },
  { href: "/login", label: "登录" },
  { href: "/register", label: "注册" }
];

export function Footer() {
  const { state } = useAuth();
  const isAuthenticated = state.status === "authenticated" && state.user !== null;
  const visibleLinks = isAuthenticated ? footerLinks : guestFooterLinks;

  return (
    <footer className="mt-10 border-t-4 border-ink bg-secondary">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 md:px-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-3">
          <Badge variant="inverse">Order Audit System</Badge>
          <p className="max-w-2xl text-sm font-bold leading-6 text-ink">
            用于辅助企业订单审核、问题追踪与报告沉淀，适用于采购、销售、履约、外贸等业务场景。审核结果仅供参考，请结合人工复核后使用。
          </p>
        </div>
        <nav className="flex flex-wrap gap-3">
          {visibleLinks.map((item) => (
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
