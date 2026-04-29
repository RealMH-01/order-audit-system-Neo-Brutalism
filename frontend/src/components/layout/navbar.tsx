"use client";

import Link from "next/link";
import { LogOut, Menu, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getStoredAccessToken } from "@/lib/api";
import { getAnnouncements } from "@/lib/api/announcements";
import {
  ANNOUNCEMENT_LAST_SEEN_CHANGED_EVENT,
  ANNOUNCEMENT_LAST_SEEN_STORAGE_KEY,
  getLastSeenAnnouncementKey,
  getLatestAnnouncementKey
} from "@/lib/announcement-seen";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

type NavLine = {
  text: string;
  className?: string;
};

type NavItem = {
  href: string;
  label: string;
  displayLines?: NavLine[];
  className?: string;
  requireRole?: "admin";
};

const navItems: NavItem[] = [
  { href: "/audit", label: "审核", displayLines: [{ text: "审核" }] },
  {
    href: "/templates",
    label: "自定义规则集",
    displayLines: [{ text: "自定义" }, { text: "规则集" }],
    className: "min-w-[5.5rem]"
  },
  { href: "/wizard", label: "引导", displayLines: [{ text: "引导" }] },
  { href: "/history", label: "历史", displayLines: [{ text: "历史" }] },
  {
    href: "/updates",
    label: "平台更新",
    displayLines: [{ text: "平台" }, { text: "更新" }]
  },
  { href: "/settings", label: "设置", displayLines: [{ text: "设置" }] },
  {
    href: "/admin/system-rules",
    label: "系统硬规则",
    displayLines: [{ text: "系统硬" }, { text: "规则", className: "tracking-[0.5em] pl-[0.5em]" }],
    className: "min-w-[5.75rem]",
    requireRole: "admin"
  }
];

const guestNavItems: NavItem[] = [
  { href: "/", label: "首页", displayLines: [{ text: "首页" }] },
  { href: "/login", label: "登录", displayLines: [{ text: "登录" }] },
  { href: "/register", label: "注册", displayLines: [{ text: "注册" }] }
];

function NavItemLabel({ item }: { item: NavItem }) {
  const displayLines = item.displayLines ?? [{ text: item.label }];

  return (
    <span className="flex flex-col items-center justify-center gap-0.5 whitespace-nowrap text-center leading-none">
      {displayLines.map((line) => (
        <span key={line.text} className={cn("whitespace-nowrap", line.className)}>
          {line.text}
        </span>
      ))}
    </span>
  );
}

export function Navbar() {
  const router = useRouter();
  const { state, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [latestAnnouncementKey, setLatestAnnouncementKey] = useState<string | null>(null);
  const [hasUnseenUpdates, setHasUnseenUpdates] = useState(false);
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

  useEffect(() => {
    if (!isAuthenticated) {
      setLatestAnnouncementKey(null);
      setHasUnseenUpdates(false);
      return;
    }

    const token = getStoredAccessToken();
    if (!token) {
      setLatestAnnouncementKey(null);
      setHasUnseenUpdates(false);
      return;
    }

    let cancelled = false;

    void getAnnouncements(token)
      .then((items) => {
        if (cancelled) {
          return;
        }

        const latest = items[0];
        if (!latest) {
          setLatestAnnouncementKey(null);
          setHasUnseenUpdates(false);
          return;
        }

        const nextLatestKey = getLatestAnnouncementKey(latest);
        setLatestAnnouncementKey(nextLatestKey);
        setHasUnseenUpdates(getLastSeenAnnouncementKey() !== nextLatestKey);
      })
      .catch(() => {
        if (!cancelled) {
          setLatestAnnouncementKey(null);
          setHasUnseenUpdates(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || !latestAnnouncementKey) {
      return;
    }

    const refreshSeenState = () => {
      setHasUnseenUpdates(getLastSeenAnnouncementKey() !== latestAnnouncementKey);
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === ANNOUNCEMENT_LAST_SEEN_STORAGE_KEY) {
        refreshSeenState();
      }
    };

    window.addEventListener(ANNOUNCEMENT_LAST_SEEN_CHANGED_EVENT, refreshSeenState);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener(ANNOUNCEMENT_LAST_SEEN_CHANGED_EVENT, refreshSeenState);
      window.removeEventListener("storage", handleStorage);
    };
  }, [isAuthenticated, latestAnnouncementKey]);

  return (
    <header className="relative z-20 border-b-4 border-ink bg-canvas">
      <div
        className={cn(
          "mx-auto flex max-w-[92rem] items-center justify-between gap-4 px-4 py-4 md:px-8 lg:grid lg:gap-5",
          isAuthenticated
            ? "lg:grid-cols-[minmax(13rem,18rem)_1fr_minmax(13rem,18rem)]"
            : "lg:grid-cols-[minmax(13rem,18rem)_1fr_minmax(8rem,14rem)]"
        )}
      >
        <div className="flex shrink-0 items-center gap-3 lg:w-full">
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

        <nav
          className={cn(
            "hidden min-w-0 items-center justify-center gap-2 lg:flex xl:gap-3",
            !isAuthenticated && "lg:translate-x-[24rem] xl:translate-x-[28rem] 2xl:translate-x-[32rem]"
          )}
        >
          {visibleNavItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative inline-flex h-14 min-w-[4.25rem] shrink-0 items-center justify-center border-4 border-transparent px-3 font-bold uppercase tracking-[0.12em] transition-all duration-100 ease-linear hover:border-ink hover:bg-secondary hover:shadow-neo-sm",
                item.className
              )}
            >
              <NavItemLabel item={item} />
              {item.href === "/updates" && hasUnseenUpdates ? (
                <span
                  aria-hidden="true"
                  className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-ink bg-red-500"
                />
              ) : null}
            </Link>
          ))}
        </nav>

        <div className="flex shrink-0 items-center justify-end gap-3 lg:w-full">
          {isAuthenticated ? (
            <div className="hidden shrink-0 items-center justify-end gap-3 lg:flex">
              <Badge variant="muted">当前账号：{accountDisplayName}</Badge>
              <Button variant="outline" onClick={handleLogout}>
                <LogOut size={18} strokeWidth={3} />
                退出登录
              </Button>
            </div>
          ) : null}
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
              className="relative inline-flex min-h-[3.5rem] items-center justify-between border-4 border-ink bg-secondary px-4 font-bold uppercase tracking-[0.14em] shadow-neo-sm transition-all duration-100 ease-linear active:translate-x-[4px] active:translate-y-[4px] active:shadow-none"
              onClick={() => setOpen(false)}
            >
              <NavItemLabel item={item} />
              {item.href === "/updates" && hasUnseenUpdates ? (
                <span
                  aria-hidden="true"
                  className="absolute right-3 top-3 h-2.5 w-2.5 rounded-full border-2 border-ink bg-red-500"
                />
              ) : null}
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
