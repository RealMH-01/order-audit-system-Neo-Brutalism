"use client";

import Link from "next/link";
import { LogOut, Menu, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/audit", label: "审核" },
  { href: "/templates", label: "规则模板" },
  { href: "/wizard", label: "引导" },
  { href: "/history", label: "历史" },
  { href: "/settings", label: "设置" },
  { href: "/admin/rules", label: "规则", requireRole: "admin" },
  { href: "/admin/system-rules", label: "系统硬规则", requireRole: "admin" }
];

const guestNavItems = [
  { href: "/", label: "首页" },
  { href: "/login", label: "登录" },
  { href: "/register", label: "注册" }
];

export function Navbar() {
  const router = useRouter();
  const { state, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const isAuthenticated = state.status === "authenticated" && state.user !== null;
  const visibleNavItems = isAuthenticated
    ? navItems.filter((item) => !item.requireRole || state.user?.role === item.requireRole)
    : guestNavItems;
  const accountDisplayName =
    state.user?.display_name?.trim() ||
    state.user?.email?.split("@")[0]?.trim() ||
    "当前账号";

  const handleLogout = () => {
    signOut();
    setOpen(false);
    router.replace("/login");
  };

  return (
    <header className="relative z-20 border-b-4 border-ink bg-canvas">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 md:px-8">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex -rotate-1 items-center gap-3 border-4 border-ink bg-acid px-4 py-3 font-black uppercase tracking-[0.18em] shadow-neo-md transition-transform duration-100 ease-linear hover:-translate-y-0.5"
          >
            <Sparkles size={18} strokeWidth={3} />
            OAS
          </Link>
          <Badge variant="secondary" className="hidden md:inline-flex">
            Neo Brutalism
          </Badge>
        </div>

        <nav className="hidden items-center gap-2 lg:flex">
          {visibleNavItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="inline-flex h-11 items-center border-4 border-transparent px-3 font-bold uppercase tracking-[0.14em] transition-all duration-100 ease-linear hover:border-ink hover:bg-secondary hover:shadow-neo-sm"
            >
              {item.label}
            </Link>
          ))}
          {isAuthenticated ? (
            <>
              <Badge variant="muted">当前账号：{accountDisplayName}</Badge>
              <Button variant="outline" onClick={handleLogout}>
                <LogOut size={18} strokeWidth={3} />
                退出登录
              </Button>
            </>
          ) : null}
        </nav>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            className="lg:hidden"
            aria-label={open ? "关闭导航菜单" : "打开导航菜单"}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X size={18} strokeWidth={3} /> : <Menu size={18} strokeWidth={3} />}
          </Button>
        </div>
      </div>

      <div
        className={cn(
          "border-t-4 border-ink bg-paper px-4 py-4 transition-all duration-100 ease-linear lg:hidden",
          open ? "block" : "hidden"
        )}
      >
        <nav className="mx-auto flex max-w-7xl flex-col gap-3">
          {visibleNavItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="inline-flex min-h-[3.5rem] items-center justify-between border-4 border-ink bg-secondary px-4 font-bold uppercase tracking-[0.14em] shadow-neo-sm transition-all duration-100 ease-linear active:translate-x-[4px] active:translate-y-[4px] active:shadow-none"
              onClick={() => setOpen(false)}
            >
              {item.label}
            </Link>
          ))}
          {isAuthenticated ? (
            <>
              <Badge variant="muted" className="justify-center">
                当前账号：{accountDisplayName}
              </Badge>
              <Button variant="outline" onClick={handleLogout}>
                <LogOut size={18} strokeWidth={3} />
                退出登录
              </Button>
            </>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
