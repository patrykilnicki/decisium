import { getDateContext } from "./date-utils";

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  created_at?: string;
}

export interface ActivityAtomContext {
  id: string;
  provider: string;
  atomType: string;
  title?: string;
  content: string;
  occurredAt: Date;
  sourceUrl?: string;
  similarity?: number;
}

/**
 * Build conversation history from messages array
 */
export function buildConversationHistory(
  messages: Array<{ role: string; content: string }>,
): string {
  if (messages.length === 0) {
    return "No previous conversation history.";
  }

  return messages
    .map((msg) => {
      const roleLabel =
        msg.role === "user"
          ? "User"
          : msg.role === "assistant"
            ? "Assistant"
            : "System";
      return `${roleLabel}: ${msg.content}`;
    })
    .join("\n\n");
}

/**
 * Build memory context from memory search results.
 * When suggest_follow_up is true, appends a hint so the agent can offer to broaden the search.
 */
export function buildMemoryContext(
  memoryResults: Array<{
    results?: Array<{ content?: string; text?: string; metadata?: unknown }>;
    total_found?: number;
    query_used?: string;
    suggest_follow_up?: boolean;
  }>,
): string {
  if (!memoryResults || memoryResults.length === 0) {
    return "No relevant memory found.";
  }

  const allResults = memoryResults.flatMap((result) => result.results || []);
  const totalFound = memoryResults.reduce(
    (sum, result) => sum + (result.total_found || 0),
    0,
  );
  const anySuggestFollowUp = memoryResults.some(
    (r) => r.suggest_follow_up === true,
  );
  const queryUsed = memoryResults[0]?.query_used;

  if (allResults.length === 0) {
    const followUpHint = anySuggestFollowUp
      ? "\n\nSuggest follow-up: offer to broaden the search or try different keywords."
      : "";
    return `No relevant memory found for "${queryUsed ?? "query"}".${followUpHint}`;
  }

  const formattedResults = allResults
    .map((item, index) => {
      const content = item.content || item.text || "";
      const metadata = item.metadata
        ? `\n[Metadata: ${JSON.stringify(item.metadata)}]`
        : "";
      return `Memory ${index + 1}:\n${content}${metadata}`;
    })
    .join("\n\n---\n\n");

  const followUpHint =
    anySuggestFollowUp && totalFound > 0
      ? `\n\nSuggest follow-up: you found ${totalFound} result(s) for "${queryUsed ?? "query"}". Offer the user to broaden the search or try different keywords to find more.`
      : "";

  return `Found ${totalFound} relevant memory fragments:\n\n${formattedResults}${followUpHint}`;
}

/**
 * Build user context string for prompts
 */
export function buildUserContext(
  userId: string,
  date: string,
  userEmail?: string,
): string {
  const parts = [`User ID: ${userId}`, `Date: ${date}`];
  if (userEmail) {
    parts.push(`Email: ${userEmail}`);
  }
  return parts.join("\n");
}

/**
 * Combine multiple context strings
 */
export function combineContexts(...contexts: string[]): string {
  return contexts.filter(Boolean).join("\n\n");
}

/**
 * Build activity atom context string for prompts
 */
export function buildActivityAtomContext(atoms: ActivityAtomContext[]): string {
  if (!atoms || atoms.length === 0) {
    return "";
  }

  const formattedAtoms = atoms
    .map((atom) => {
      const date = atom.occurredAt.toISOString().split("T")[0];
      const providerLabel = atom.provider.replace(/_/g, " ");
      const parts: string[] = [];

      // Header with type and date
      parts.push(`[${providerLabel} ${atom.atomType} - ${date}]`);

      // Title if available
      if (atom.title) {
        parts.push(`Title: ${atom.title}`);
      }

      // Content
      parts.push(atom.content);

      // Source URL if available
      if (atom.sourceUrl) {
        parts.push(`Source: ${atom.sourceUrl}`);
      }

      return parts.join("\n");
    })
    .join("\n\n---\n\n");

  return `Activity from Connected Apps (${atoms.length} items):\n\n${formattedAtoms}`;
}

/**
 * Build full context for agent invocation
 */
export function buildAgentContext(options: {
  userId: string;
  currentDate: string;
  conversationHistory?: string;
  memoryContext?: string;
  activityAtoms?: ActivityAtomContext[];
  userEmail?: string;
  additionalContext?: string;
}): string {
  const parts: string[] = [];

  // User context
  parts.push(
    buildUserContext(options.userId, options.currentDate, options.userEmail),
  );

  // Date context
  parts.push(getDateContext(options.currentDate));

  // Conversation history
  if (options.conversationHistory) {
    parts.push("Conversation History:", options.conversationHistory);
  }

  // Memory context
  if (options.memoryContext) {
    parts.push("Relevant Memory:", options.memoryContext);
  }

  // Activity atoms from integrations
  if (options.activityAtoms && options.activityAtoms.length > 0) {
    parts.push(buildActivityAtomContext(options.activityAtoms));
  }

  // Additional context
  if (options.additionalContext) {
    parts.push(options.additionalContext);
  }

  return combineContexts(...parts);
}

/**
 * Build context with integrated memory (memory + activity atoms)
 */
export function buildIntegratedContext(options: {
  userId: string;
  currentDate: string;
  conversationHistory?: string;
  memoryFragments?: Array<{
    content: string;
    metadata?: Record<string, unknown>;
  }>;
  activityAtoms?: ActivityAtomContext[];
  userEmail?: string;
  additionalContext?: string;
}): string {
  const parts: string[] = [];

  // User context
  parts.push(
    buildUserContext(options.userId, options.currentDate, options.userEmail),
  );

  // Date context
  parts.push(getDateContext(options.currentDate));

  // Conversation history
  if (options.conversationHistory) {
    parts.push("## Conversation History\n" + options.conversationHistory);
  }

  // Combined memory and activity section
  const memoryParts: string[] = [];

  // Memory fragments
  if (options.memoryFragments && options.memoryFragments.length > 0) {
    const memoryContent = options.memoryFragments
      .map((f) => {
        const meta = f.metadata as { date?: string; type?: string } | undefined;
        const date = meta?.date ?? "";
        const type = meta?.type ?? "memory";
        return `[${type}${date ? ` - ${date}` : ""}]\n${f.content}`;
      })
      .join("\n\n");
    memoryParts.push(`### Relevant Memories\n${memoryContent}`);
  }

  // Activity atoms
  if (options.activityAtoms && options.activityAtoms.length > 0) {
    const atomContent = options.activityAtoms
      .map((atom) => {
        const date = atom.occurredAt.toISOString().split("T")[0];
        const providerLabel = atom.provider.replace(/_/g, " ");
        const titlePart = atom.title ? ` - "${atom.title}"` : "";
        return `[${providerLabel} ${atom.atomType} - ${date}${titlePart}]\n${atom.content}`;
      })
      .join("\n\n");
    memoryParts.push(`### Activity from Connected Apps\n${atomContent}`);
  }

  if (memoryParts.length > 0) {
    parts.push("## Context from Your Data\n" + memoryParts.join("\n\n"));
  }

  // Additional context
  if (options.additionalContext) {
    parts.push(options.additionalContext);
  }

  return combineContexts(...parts);
}
