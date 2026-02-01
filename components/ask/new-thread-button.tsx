"use client";

import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { useRouter } from "next/navigation";

export function NewThreadButton() {
  const router = useRouter();

  async function handleCreate() {
    try {
      const response = await fetch("/api/ask/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New Conversation" }),
      });

      if (response.ok) {
        const thread = await response.json();
        router.push(`/ask/${thread.id}`);
      }
    } catch (error) {
      console.error("Failed to create thread:", error);
    }
  }

  return (
    <Button onClick={handleCreate}>
      <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} data-icon="inline-start" />
      New Conversation
    </Button>
  );
}
