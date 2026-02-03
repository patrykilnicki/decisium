"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CentralIcon } from "@/components/ui/central-icon";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  name: "IconHome" | "IconStar" | "IconChart1" | "IconNote1" | "IconSettingsGear1";
  label: string;
}

const navItems: NavItem[] = [
  { href: "/", name: "IconHome", label: "Home" },
  { href: "/ask", name: "IconStar", label: "Ask AI" },
  { href: "/summaries", name: "IconChart1", label: "Summaries" },
  { href: "/vault", name: "IconNote1", label: "Vault" },
  { href: "/settings", name: "IconSettingsGear1", label: "Settings" },
];

export function Nav() {
  const pathname = usePathname();
  const [user, setUser] = useState<{ avatar_url?: string; email?: string; full_name?: string } | null>(null);
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
          full_name: authUser.user_metadata?.full_name ?? authUser.user_metadata?.name,
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
      {/* Primary action - green gradient button with sparkle */}
      <Link
        href="/ask"
        className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-sm transition-opacity hover:opacity-90"
        aria-label="Ask AI"
      >
        <CentralIcon
          name="IconSparkle"
          iconFill="filled"
          size={24}
          className="text-white"
        />
      </Link>

      {/* Nav items */}
      <nav className="flex flex-col gap-4" aria-label="Navigation links">
        {navItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex size-12 items-center justify-center rounded-lg transition-colors",
                isActive
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
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
