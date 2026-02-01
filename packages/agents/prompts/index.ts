import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// Get the directory of this file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load a prompt from a markdown file
 * Extracts the content after the first "---" separator (skipping frontmatter)
 */
function loadPrompt(filename: string): string {
  const filepath = join(__dirname, filename);
  const content = readFileSync(filepath, "utf-8");
  
  // Find the content after the header section (after "---")
  const parts = content.split("---");
  
  // If there are multiple "---" separators, get the content after the second one
  // This handles both frontmatter format and our header format
  if (parts.length >= 3) {
    return parts.slice(2).join("---").trim();
  }
  
  // If only one separator, get content after it
  if (parts.length >= 2) {
    return parts.slice(1).join("---").trim();
  }
  
  // No separator, return the whole content
  return content.trim();
}

/**
 * Extract a specific section from a markdown file
 * Sections are denoted by ## headers
 */
function extractSection(content: string, sectionName: string): string {
  const regex = new RegExp(`## ${sectionName}[\\s\\S]*?\`\`\`([\\s\\S]*?)\`\`\``, "i");
  const match = content.match(regex);
  return match ? match[1].trim() : "";
}

// ═══════════════════════════════════════════════════════════════
// MAIN AGENT PROMPTS (Unified Architecture)
// ═══════════════════════════════════════════════════════════════

export const MAIN_AGENT_SYSTEM_PROMPT = loadPrompt("main-agent.md");
export const DAILY_SUBAGENT_SYSTEM_PROMPT = loadPrompt("daily-subagent.md");
export const ASK_SUBAGENT_SYSTEM_PROMPT = loadPrompt("ask-subagent.md");

// ═══════════════════════════════════════════════════════════════
// ROOT AGENT PROMPTS (Legacy)
// ═══════════════════════════════════════════════════════════════

export const ROOT_AGENT_SYSTEM_PROMPT = loadPrompt("root-agent.md");

// ═══════════════════════════════════════════════════════════════
// DAILY AGENT PROMPTS
// ═══════════════════════════════════════════════════════════════

const dailyAgentContent = readFileSync(join(__dirname, "daily-agent.md"), "utf-8");

export const DAILY_WELCOME_SYSTEM_PROMPT = extractSection(dailyAgentContent, "Welcome System Prompt");

export const DAILY_CLASSIFIER_SYSTEM_PROMPT = extractSection(dailyAgentContent, "Classifier System Prompt");

export const DAILY_RESPONSE_SYSTEM_PROMPT = extractSection(dailyAgentContent, "Response System Prompt");

// ═══════════════════════════════════════════════════════════════
// ORCHESTRATOR AGENT PROMPTS
// ═══════════════════════════════════════════════════════════════

export const ORCHESTRATOR_SYSTEM_PROMPT = loadPrompt("orchestrator-agent.md");

// ═══════════════════════════════════════════════════════════════
// ROUTER AGENT PROMPTS
// ═══════════════════════════════════════════════════════════════

export const ROUTER_SYSTEM_PROMPT = loadPrompt("router-agent.md");

// ═══════════════════════════════════════════════════════════════
// NODE PROMPTS
// ═══════════════════════════════════════════════════════════════

export const GRADE_DOCUMENTS_PROMPT = loadPrompt("grade-documents.md");

export const REWRITE_QUERY_PROMPT = loadPrompt("rewrite-query.md");

// ═══════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Replace template variables in a prompt
 * @param prompt The prompt template
 * @param variables Object with variable names and values
 * @returns The prompt with variables replaced
 */
export function replacePromptVariables(
  prompt: string,
  variables: Record<string, string>
): string {
  let result = prompt;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`{{${key}}}`, "g"), value);
  }
  return result;
}

/**
 * Get a prompt with the current date replaced
 */
export function getPromptWithDate(prompt: string, currentDate?: string): string {
  const date = currentDate || new Date().toISOString().split("T")[0];
  return replacePromptVariables(prompt, { currentDate: date });
}
