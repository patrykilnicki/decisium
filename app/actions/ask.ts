"use server";

import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/supabase/db";
import {
  AskThread,
  AskMessageInput,
} from "@/packages/agents/schemas/ask.schema";
import { getUserContext } from "@/packages/agents/lib/auth";
import { buildConversationHistory } from "@/packages/agents/lib/context";
import { handleAgentError } from "@/packages/agents/lib/error-handler";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueTask } from "@/lib/tasks/task-repository";
import { createInitialOrchestratorState } from "@/packages/agents/schemas/orchestrator.schema";
import type { Json } from "@/types/supabase";
import { HumanMessage } from "@langchain/core/messages";
import { getDefaultLLM } from "@/packages/agents/lib/llm";

/** Map Supabase row (nullable columns) to AskThread (optional = undefined). */
function toAskThread(row: {
  id: string;
  user_id: string;
  title: string | null;
  created_at: string | null;
  updated_at: string | null;
}): AskThread {
  return {
    id: row.id,
    user_id: row.user_id,
    title: row.title ?? undefined,
    created_at: row.created_at ?? undefined,
    updated_at: row.updated_at ?? undefined,
  };
}

const THREAD_TITLE_FALLBACK = "New chat";

export async function createThread(
  userId: string,
  title?: string,
): Promise<AskThread> {
  const supabase = await createClient();

  const { data, error } = await db.insertOne(supabase, "ask_threads", {
    user_id: userId,
    title: title || THREAD_TITLE_FALLBACK,
  });

  if (error || !data) {
    throw new Error(
      `Failed to create thread: ${error?.message ?? "Unknown error"}`,
    );
  }

  return toAskThread(data as Parameters<typeof toAskThread>[0]);
}

export async function updateThread(
  threadId: string,
  userId: string,
  payload: { title?: string },
): Promise<AskThread | null> {
  const supabase = await createClient();
  const thread = await getThread(threadId, userId);
  if (!thread) return null;
  const { data, error } = await db.update(
    supabase,
    "ask_threads",
    { id: threadId, user_id: userId },
    payload,
    { returning: "single" },
  );
  if (error || !data) return null;
  return toAskThread(data as Parameters<typeof toAskThread>[0]);
}

const TITLE_FALLBACK_MAX_LEN = 50;
const ASK_HISTORY_MAX_MESSAGES = 12;
const ASK_HISTORY_MAX_CHARS_PER_MESSAGE = 500;
const ASK_HISTORY_MAX_TOTAL_CHARS = 6000;

/** Generate a short, ChatGPT-style thread title from the first message. Always in English. */
export async function generateThreadTitle(
  firstMessage: string,
): Promise<string> {
  const trimmed = firstMessage.trim();
  if (!trimmed) return THREAD_TITLE_FALLBACK;
  try {
    const llm = getDefaultLLM();
    const prompt = `Generate a short chat title for this message. Rules:
- Write the title in English only, even if the message is in another language.
- Keep it to 3-6 words. Be concise and descriptive (e.g. "How to center a div", "Python list comprehension", "Explain quantum computing").
- Capture the main topic or question. No quotes, no punctuation at the end.
- Reply with nothing but the title, no explanation.

Message: ${trimmed.slice(0, 500)}`;
    const response = await llm.invoke([new HumanMessage(prompt)]);
    const text =
      typeof response.content === "string"
        ? response.content
        : Array.isArray(response.content)
          ? (response.content as { type: string; text?: string }[])
              .map((c) => ("text" in c ? c.text : ""))
              .join("")
          : "";
    const raw = text
      .trim()
      .replace(/^["']|["']$/g, "")
      .slice(0, 80);
    const title = raw || trimmed.slice(0, TITLE_FALLBACK_MAX_LEN).trim();
    return title || THREAD_TITLE_FALLBACK;
  } catch {
    return trimmed.length <= TITLE_FALLBACK_MAX_LEN
      ? trimmed
      : `${trimmed.slice(0, TITLE_FALLBACK_MAX_LEN).trim()}…`;
  }
}

/** Create a new thread with the first user message, enqueue agent response, and set title from first message. */
export async function createThreadWithFirstMessage(
  userId: string,
  initialMessage: string,
): Promise<AskThread> {
  const thread = await createThread(userId, THREAD_TITLE_FALLBACK);
  const threadId = thread.id;
  if (!threadId) throw new Error("Created thread missing id");
  await sendMessage(threadId, { content: initialMessage, role: "user" });
  const title = await generateThreadTitle(initialMessage);
  await updateThread(threadId, userId, { title });
  const updated = await getThread(threadId, userId);
  return updated ?? thread;
}

export async function getThreads(userId: string): Promise<AskThread[]> {
  const supabase = await createClient();

  const { data, error } = await db.selectMany(
    supabase,
    "ask_threads",
    {
      user_id: userId,
    },
    { order: { column: "updated_at", ascending: false } },
  );

  if (error) {
    throw new Error(`Failed to fetch threads: ${error.message}`);
  }

  return (data || []).map((row) =>
    toAskThread(row as Parameters<typeof toAskThread>[0]),
  );
}

export async function getThread(
  threadId: string,
  userId: string,
): Promise<AskThread | null> {
  const supabase = await createClient();

  const { data, error } = await db.selectOne(supabase, "ask_threads", {
    id: threadId,
    user_id: userId,
  });

  if (error || !data) {
    return null;
  }

  return toAskThread(data as Parameters<typeof toAskThread>[0]);
}

export async function getThreadMessages(threadId: string, userId: string) {
  const supabase = await createClient();

  // Verify thread belongs to user
  const thread = await getThread(threadId, userId);
  if (!thread) {
    throw new Error("Thread not found");
  }

  const { data, error } = await db.selectMany(
    supabase,
    "ask_messages",
    { thread_id: threadId },
    { order: { column: "created_at", ascending: true } },
  );

  if (error) {
    throw new Error(`Failed to fetch messages: ${error.message}`);
  }

  return data || [];
}

export async function sendMessage(
  threadId: string,
  messageInput: Omit<AskMessageInput, "thread_id">,
) {
  try {
    // Get authenticated user context
    const { userId, currentDate, timezone, userEmail, preferredModel } =
      await getUserContext();

    // Verify thread belongs to user
    const thread = await getThread(threadId, userId);
    if (!thread) {
      throw new Error("Thread not found");
    }

    // Get existing thread messages (before adding the new one)
    const existingMessages = await getThreadMessages(threadId, userId);

    // Build conversation history from existing messages
    const conversationHistory = buildConversationHistory(existingMessages, {
      maxMessages: ASK_HISTORY_MAX_MESSAGES,
      maxCharsPerMessage: ASK_HISTORY_MAX_CHARS_PER_MESSAGE,
      maxTotalChars: ASK_HISTORY_MAX_TOTAL_CHARS,
    });

    const supabase = await createClient();

    // Save user message first
    const { data: savedUserMessage, error: userMsgError } = await db.insertOne(
      supabase,
      "ask_messages",
      {
        thread_id: threadId,
        role: "user",
        content: messageInput.content,
      },
    );

    if (userMsgError || !savedUserMessage) {
      throw new Error(
        `Failed to save user message: ${userMsgError?.message ?? "Unknown error"}`,
      );
    }

    const adminClient = createAdminClient();
    const taskType = "orchestrator.invoke" as const;
    const initialState = {
      ...createInitialOrchestratorState({
        userId,
        threadId,
        userMessage: messageInput.content,
        currentDate,
        timezone,
        userEmail,
        conversationHistory,
        preferredModel,
        userMessageId: savedUserMessage.id,
      }),
    };

    const task = await enqueueTask(adminClient, {
      user_id: userId,
      session_id: threadId,
      task_type: taskType,
      status: "pending",
      input: { state: initialState } as unknown as Json,
    });
    console.info(
      `[ask] Enqueued task ${task.id} with type=${taskType} for thread=${threadId}`,
    );

    // Trigger execution: HTTP on production (new invocation), in-process locally (no CRON needed)
    const { triggerTask } = await import("@/lib/tasks/task-processor");
    triggerTask(task.id);

    return {
      userMessage: savedUserMessage,
      taskId: task.id,
      mode: "agentic",
    };
  } catch (error) {
    handleAgentError(error, {
      agentType: "ask",
      action: "send_message",
      metadata: { threadId },
    });
    throw error;
  }
}

export async function deleteThread(threadId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Unauthorized");
  }

  const { error } = await db.remove(supabase, "ask_threads", {
    id: threadId,
    user_id: user.id,
  });

  if (error) {
    throw new Error(`Failed to delete thread: ${error.message}`);
  }
}
