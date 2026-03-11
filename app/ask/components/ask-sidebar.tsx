"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CentralIcon } from "@/components/ui/central-icon";
import { useAskLayout } from "@/app/ask/ask-layout-context";

function ThreadListSkeleton() {
  return (
    <div className="flex flex-col gap-0 px-3" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="rounded-lg px-3 py-2">
          <Skeleton className="h-5 w-full max-w-[90%]" />
        </div>
      ))}
    </div>
  );
}

export function AskSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { threads, threadsLoading } = useAskLayout();

  function handleNewChat() {
    router.push("/ask");
  }

  return (
    <aside
      className="flex h-full min-h-0 w-[272px] shrink-0 flex-col border-r border-border/40"
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
      <nav
        className="flex min-h-0 flex-1 flex-col gap-0 overflow-y-auto px-3 pb-4"
        aria-label="Thread list"
      >
        {threadsLoading ? (
          <ThreadListSkeleton />
        ) : (
          threads.map((thread) => {
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
                  {thread.title || "New chat"}
                </span>
              </Link>
            );
          })
        )}
      </nav>
    </aside>
  );
}
