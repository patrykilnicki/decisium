"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CentralIcon } from "@/components/ui/central-icon";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  name:
    | "IconHomeOpen"
    | "IconSparkle"
    | "IconSearchlinesSparkle"
    | "IconNote1"
    | "IconCalendarClock"
    | "IconSettingsGear2";
  label: string;
}

const navItems: NavItem[] = [
  { href: "/home", name: "IconHomeOpen", label: "Home" },
  { href: "/ask", name: "IconSparkle", label: "Ask AI" },
  { href: "/summaries", name: "IconCalendarClock", label: "Summaries" },
  { href: "/collections", name: "IconSearchlinesSparkle", label: "Collections" },
  { href: "/settings", name: "IconSettingsGear2", label: "Settings" },
];

export function Nav() {
  const pathname = usePathname();
  const [user, setUser] = useState<{
    avatar_url?: string;
    email?: string;
    full_name?: string;
  } | null>(null);
  const supabase = createClient();

  useEffect(() => {
    async function fetchUser() {
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();
      if (authUser) {
        setUser({
          avatar_url:
            authUser.user_metadata?.avatar_url ??
            authUser.user_metadata?.picture,
          email: authUser.email ?? undefined,
          full_name:
            authUser.user_metadata?.full_name ?? authUser.user_metadata?.name,
        });
      }
    }
    fetchUser();
  }, [supabase]);

  function getInitials(name?: string, email?: string) {
    if (name) {
      return name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
    }
    if (email) {
      return email[0].toUpperCase();
    }
    return "?";
  }

  return (
    <aside
      className="flex w-16 flex-col items-center justify-between gap-6 border-r border-border/40 bg-background py-6 shadow-sm"
      aria-label="Main navigation"
    >
      {/* Primary action - green gradient button with logo */}
      <Link
        href="/ask"
        aria-label="Ask AI"
      >
        <Image
          src="/logo.svg"
          alt="Ask AI"
          width={32}
          height={32}
          className="text-white"
        />
      </Link>

      {/* Nav items */}
      <nav className="flex flex-col gap-4" aria-label="Navigation links">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex size-12 items-center justify-center rounded-lg transition-colors",
                isActive
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
              aria-label={item.label}
              aria-current={isActive ? "page" : undefined}
            >
              <CentralIcon
                name={item.name}
                iconFill={isActive ? "filled" : "outlined"}
                iconStroke="2"
                size={24}
              />
            </Link>
          );
        })}
      </nav>

      {/* User avatar */}
      <Link
        href="/settings"
        className="flex items-center justify-center"
        aria-label="Profile settings"
      >
        <Avatar size="default" className="size-9 ring-2 ring-border">
          <AvatarImage src={user?.avatar_url} alt="" />
          <AvatarFallback className="text-xs">
            {getInitials(user?.full_name, user?.email)}
          </AvatarFallback>
        </Avatar>
      </Link>
    </aside>
  );
}
