"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const settingsNavItems: { href: string; label: string }[] = [
  { href: "/settings/account", label: "Account" },
  { href: "/settings/preferences", label: "Preferences" },
  { href: "/settings/integrations", label: "Integrations" },
  { href: "/settings/reflections", label: "Reflections" },
  { href: "/settings/tasks", label: "Tasks" },
];

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <aside
      className="flex w-[272px] shrink-0 flex-col border-r border-border/40 gap-0"
      aria-label="Settings"
    >
      <div className="flex flex-col px-6 py-7 text-sm font-semibold text-foreground">
        Settings
      </div>
      <nav className="flex flex-col gap-0 px-3" aria-label="Settings pages">
        {settingsNavItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-3 py-2.5 text-sm font-normal leading-5 transition-colors",
                isActive
                  ? "bg-muted text-foreground font-semibold"
                  : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
              )}
            >
              <span className="block truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
