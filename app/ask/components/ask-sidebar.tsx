"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CentralIcon } from "@/components/ui/central-icon";
import { useAskLayout } from "@/app/ask/ask-layout-context";

export function AskSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { threads } = useAskLayout();

  function handleNewChat() {
    router.push("/ask");
  }

  return (
    <aside
      className="flex w-[272px] shrink-0 flex-col border-r border-border/40"
      aria-label="Conversations"
    >
      <div className="flex flex-col gap-2 px-6 py-7 text-sm font-semibold text-foreground">
        Conversations
      </div>
      <div className="flex flex-col px-3 mb-5 text-sm font-normal text-muted-foreground">
        <Button
          variant="ghost"
          className="w-full justify-start gap-2"
          onClick={handleNewChat}
        >
          <CentralIcon name="IconEditBig" size={20} className="size-5" />
          New chat
        </Button>
      </div>
      <nav className="flex flex-col gap-0 px-3" aria-label="Thread list">
        {threads.map((thread) => {
          const href = `/ask/${thread.id}`;
          const isActive = pathname === href;
          return (
            <Link
              key={thread.id}
              href={href}
              className={cn(
                "rounded-lg px-3 py-2 text-sm font-normal leading-5 transition-colors",
                isActive
                  ? "bg-muted text-foreground font-semibold"
                  : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
              )}
            >
              <span className="block truncate">
                {thread.title || "Untitled Conversation"}
              </span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
