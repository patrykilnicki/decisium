"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CentralIcon } from "@/components/ui/central-icon";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { createClient } from "@/lib/supabase/client";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

interface NavItem {
  href: string;
  name:
    | "IconHomeOpen"
    | "IconSparkle"
    | "IconSearchlinesSparkle"
    | "IconCalendarClock"
    | "IconSettingsGear2";
  label: string;
}

const mainNavItems: NavItem[] = [
  { href: "/home", name: "IconHomeOpen", label: "Home" },
  { href: "/ask", name: "IconSparkle", label: "Ask AI" },
  { href: "/summaries", name: "IconCalendarClock", label: "Summaries" },
  {
    href: "/collections",
    name: "IconSearchlinesSparkle",
    label: "Collections",
  },
  { href: "/settings", name: "IconSettingsGear2", label: "Settings" },
];

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

export function AppSidebar() {
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

  const isSettingsActive = pathname.startsWith("/settings");

  return (
    <Sidebar
      collapsible="icon"
      disableBackground
      className="border-r border-border/40"
    >
      <SidebarHeader className="flex flex-col items-start gap-6 py-6 px-2 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0">
        <Link href="/ask" aria-label="Ask AI" className="flex shrink-0">
          <Image
            src="/logo.svg"
            alt="Ask AI"
            width={32}
            height={32}
            className="text-white"
          />
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="flex w-full flex-col gap-4 items-stretch">
              {mainNavItems.map((item) => {
                const isActive =
                  pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);
                const isSettings = item.href === "/settings";

                return (
                  <SidebarMenuItem key={item.name}>
                    <SidebarMenuButton
                      asChild
                      isActive={isSettings ? isSettingsActive : isActive}
                      tooltip={item.label}
                      className="group-data-[collapsible=icon]:!size-11 flex items-center justify-start group-data-[collapsible=icon]:justify-center rounded-lg"
                    >
                      <Link
                        href={item.href}
                        aria-label={item.label}
                        aria-current={
                          isSettings
                            ? isSettingsActive
                              ? "page"
                              : undefined
                            : isActive
                              ? "page"
                              : undefined
                        }
                        className="flex items-center gap-2 w-full min-w-0"
                      >
                        <CentralIcon
                          name={item.name}
                          iconFill={
                            isSettings
                              ? isSettingsActive
                                ? "filled"
                                : "outlined"
                              : isActive
                                ? "filled"
                                : "outlined"
                          }
                          iconStroke="1.5"
                          className="!size-6 shrink-0"
                        />
                        <span className="group-data-[collapsible=icon]:hidden">
                          {item.label}
                        </span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="flex flex-col items-start p-6 px-2 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0">
        <Link
          href="/settings"
          className="flex items-center justify-start group-data-[collapsible=icon]:justify-center shrink-0"
          aria-label="Profile settings"
        >
          <Avatar size="default" className="size-9 ring-2 ring-border">
            <AvatarImage src={user?.avatar_url} alt="" />
            <AvatarFallback className="text-xs">
              {getInitials(user?.full_name, user?.email)}
            </AvatarFallback>
          </Avatar>
        </Link>
      </SidebarFooter>
    </Sidebar>
  );
}
