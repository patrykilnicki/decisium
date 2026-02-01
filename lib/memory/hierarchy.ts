import { MemoryRetrievalResult } from "@/packages/agents/schemas/memory.schema";

export function formatMemoryForPrompt(
  results: MemoryRetrievalResult[]
): string {
  if (results.length === 0) {
    return "No relevant memories found.";
  }

  let formatted = "";

  for (const result of results) {
    const levelLabel = {
      monthly: "Monthly Insights",
      weekly: "Weekly Patterns",
      daily: "Daily Summaries",
      raw: "Raw Events",
    }[result.hierarchy_level];

    formatted += `\n## ${levelLabel}\n\n`;

    for (const fragment of result.fragments) {
      formatted += `- ${fragment.content}\n`;
      if (fragment.metadata.date) {
        formatted += `  (Date: ${fragment.metadata.date})\n`;
      }
    }
  }

  return formatted;
}

export function getMemoryContext(
  results: MemoryRetrievalResult[],
  maxTokens: number = 2000
): string {
  // Simple token estimation (rough: 1 token ≈ 4 characters)
  const maxChars = maxTokens * 4;
  let context = "";
  let currentChars = 0;

  for (const result of results) {
    const levelLabel = {
      monthly: "Monthly Insights",
      weekly: "Weekly Patterns",
      daily: "Daily Summaries",
      raw: "Raw Events",
    }[result.hierarchy_level];

    const sectionHeader = `\n## ${levelLabel}\n\n`;
    if (currentChars + sectionHeader.length > maxChars) break;

    context += sectionHeader;
    currentChars += sectionHeader.length;

    for (const fragment of result.fragments) {
      const fragmentText = `- ${fragment.content}\n`;
      if (currentChars + fragmentText.length > maxChars) {
        context += "...\n";
        break;
      }
      context += fragmentText;
      currentChars += fragmentText.length;
    }
  }

  return context || "No relevant memories found.";
}
