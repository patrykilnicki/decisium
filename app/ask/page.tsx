"use client";

import { useRouter } from "next/navigation";
import { ChatInput } from "@/components/chat/chat-input";
import { useAskLayout } from "@/app/ask/ask-layout-context";
import {
  SuggestionCards,
  type SuggestionItem,
} from "@/app/ask/components/suggestion-cards";

export default function AskPage() {
  const router = useRouter();
  const { loadThreads } = useAskLayout();

  async function handleSuggestionSelect(item: SuggestionItem) {
    try {
      const response = await fetch("/api/ask/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: item.title }),
      });
      if (response.ok) {
        await loadThreads();
        const thread = await response.json();
        router.push(`/ask/${thread.id}`);
      }
    } catch (error) {
      console.error("Failed to create thread:", error);
    }
  }

  async function handleAskSend(message: string) {
    const response = await fetch("/api/ask/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: message.slice(0, 80) }),
    });
    if (response.ok) {
      await loadThreads();
      const thread = await response.json();
      router.push(`/ask/${thread.id}`);
    }
  }

  return (
    <div className="flex h-full w-full">
      <div className="flex max-w-[640px] mx-auto flex-1 flex-col items-center justify-center gap-20 py-20">
        <div className="flex w-full flex-col gap-12">
          <h1 className="text-center text-[28px] font-semibold leading-9 tracking-[-0.28px] text-foreground">
            Ask about your work, decisions or patterns
          </h1>
          <SuggestionCards onSelect={handleSuggestionSelect} />
        </div>
        <div className="flex w-full flex-col gap-1.5">
          <ChatInput
            variant="full"
            placeholder="Ask anything..."
            onSend={handleAskSend}
          />
          <p className="truncate text-center text-[11px] leading-5 tracking-[-0.11px] text-muted-foreground">
            The agent could make mistakes. Please report any issue to improve
            the experience
          </p>
        </div>
      </div>
    </div>
  );
}
