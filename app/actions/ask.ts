"use server";

import { createClient } from "@/lib/supabase/server";
import { AskThread, AskMessageInput } from "@/packages/agents/schemas/ask.schema";
import { getUserContext } from "@/packages/agents/lib/auth";
import { buildConversationHistory } from "@/packages/agents/lib/context";
import { handleAgentError } from "@/packages/agents/lib/error-handler";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueTask } from "@/lib/tasks/task-repository";
import type { TaskType } from "@/lib/tasks/task-definitions";
import { getAgentMode, type RootGraphState } from "@/packages/agents/core/root.agent";
import { createInitialOrchestratorState } from "@/packages/agents/schemas/orchestrator.schema";

export async function createThread(userId: string, title?: string): Promise<AskThread> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("ask_threads")
    .insert({
      user_id: userId,
      title: title || "New Conversation",
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create thread: ${error.message}`);
  }

  return data;
}

export async function getThreads(userId: string): Promise<AskThread[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("ask_threads")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch threads: ${error.message}`);
  }

  return data || [];
}

export async function getThread(threadId: string, userId: string): Promise<AskThread | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("ask_threads")
    .select("*")
    .eq("id", threadId)
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    return null;
  }

  return data;
}

export async function getThreadMessages(threadId: string, userId: string) {
  const supabase = await createClient();

  // Verify thread belongs to user
  const thread = await getThread(threadId, userId);
  if (!thread) {
    throw new Error("Thread not found");
  }

  const { data, error } = await supabase
    .from("ask_messages")
    .select("*")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch messages: ${error.message}`);
  }

  return data || [];
}

export async function sendMessage(
  threadId: string,
  messageInput: Omit<AskMessageInput, "thread_id">
) {
  try {
    // Get authenticated user context
    const { userId, currentDate, userEmail } = await getUserContext();

    // Verify thread belongs to user
    const thread = await getThread(threadId, userId);
    if (!thread) {
      throw new Error("Thread not found");
    }

    // Get existing thread messages (before adding the new one)
    const existingMessages = await getThreadMessages(threadId, userId);

    // Build conversation history from existing messages
    const conversationHistory = buildConversationHistory(existingMessages);

    const supabase = await createClient();

    // Save user message first
    const { data: savedUserMessage, error: userMsgError } = await supabase
      .from("ask_messages")
      .insert({
        thread_id: threadId,
        role: "user",
        content: messageInput.content,
      })
      .select()
      .single();

    if (userMsgError) {
      throw new Error(`Failed to save user message: ${userMsgError.message}`);
    }

    const mode = getAgentMode();
    const adminClient = createAdminClient();

    let taskType: TaskType;
    let initialState: object;

    if (mode === "agentic") {
      taskType = "orchestrator.router";
      initialState = {
        ...createInitialOrchestratorState({
          userId,
          threadId,
          userMessage: messageInput.content,
          currentDate,
          userEmail,
          conversationHistory,
        }),
        userMessageId: savedUserMessage.id,
      };
    } else {
      taskType = "root.save_user_message";
      const rootState: RootGraphState = {
        userId,
        threadId,
        userMessage: messageInput.content,
        currentDate,
        userEmail,
        conversationHistory,
        userMessageId: savedUserMessage.id,
      };
      initialState = rootState;
    }

    const task = await enqueueTask(adminClient, {
      user_id: userId,
      session_id: threadId,
      task_type: taskType,
      input: { state: initialState },
    });

    return {
      userMessage: savedUserMessage,
      taskId: task.id,
      mode,
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

  const { error } = await supabase
    .from("ask_threads")
    .delete()
    .eq("id", threadId)
    .eq("user_id", user.id);

  if (error) {
    throw new Error(`Failed to delete thread: ${error.message}`);
  }
}
