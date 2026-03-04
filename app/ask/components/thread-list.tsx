"use client";

import { AskThread } from "@/packages/agents/schemas/ask.schema";
import { Card, CardContent } from "@/components/ui/card";
import { format } from "date-fns";
import Link from "next/link";

interface ThreadListProps {
  threads: AskThread[];
}

export function ThreadList({ threads }: ThreadListProps) {
  if (threads.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-8">
        No conversations yet. Start a new one!
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {threads.map((thread) => (
        <Link key={thread.id} href={`/ask/${thread.id}`}>
          <Card className="hover:bg-muted/50 cursor-pointer">
            <CardContent className="p-4">
              <div className="font-semibold">
                {thread.title || "Untitled Conversation"}
              </div>
              {thread.updated_at && (
                <div className="text-sm text-muted-foreground mt-1">
                  {format(new Date(thread.updated_at), "MMM d, yyyy")}
                </div>
              )}
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
