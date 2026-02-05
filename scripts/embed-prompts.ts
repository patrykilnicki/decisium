/**
 * Embeds prompt .md files into a TypeScript module for serverless deployment.
 * Run before build: pnpm exec tsx scripts/embed-prompts.ts
 */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "../packages/agents/prompts");

function loadPrompt(filename: string): string {
  const content = readFileSync(join(PROMPTS_DIR, filename), "utf-8");
  const parts = content.split("---");
  if (parts.length >= 3) return parts.slice(2).join("---").trim();
  if (parts.length >= 2) return parts.slice(1).join("---").trim();
  return content.trim();
}

function extractSection(content: string, sectionName: string): string {
  const regex = new RegExp(
    `## ${sectionName}[\\s\\S]*?\`\`\`([\\s\\S]*?)\`\`\``,
    "i",
  );
  const match = content.match(regex);
  return match ? match[1].trim() : "";
}

function escapeForTemplateLiteral(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${");
}

function main() {
  const dailyAgentContent = readFileSync(
    join(PROMPTS_DIR, "daily-agent.md"),
    "utf-8",
  );

  const output = `/**
 * AUTO-GENERATED - Do not edit. Run: pnpm exec tsx scripts/embed-prompts.ts
 * Embeds prompts for serverless deployment (Vercel).
 */
${[
  ["MAIN_AGENT_SYSTEM_PROMPT", loadPrompt("main-agent.md")],
  ["DAILY_SUBAGENT_SYSTEM_PROMPT", loadPrompt("daily-subagent.md")],
  ["ASK_SUBAGENT_SYSTEM_PROMPT", loadPrompt("ask-subagent.md")],
  ["ROOT_AGENT_SYSTEM_PROMPT", loadPrompt("root-agent.md")],
  [
    "DAILY_WELCOME_SYSTEM_PROMPT",
    extractSection(dailyAgentContent, "Welcome System Prompt"),
  ],
  [
    "DAILY_CLASSIFIER_SYSTEM_PROMPT",
    extractSection(dailyAgentContent, "Classifier System Prompt"),
  ],
  [
    "DAILY_RESPONSE_SYSTEM_PROMPT",
    extractSection(dailyAgentContent, "Response System Prompt"),
  ],
  ["ORCHESTRATOR_SYSTEM_PROMPT", loadPrompt("orchestrator-agent.md")],
  ["ROUTER_SYSTEM_PROMPT", loadPrompt("router-agent.md")],
  ["GRADE_DOCUMENTS_PROMPT", loadPrompt("grade-documents.md")],
  ["REWRITE_QUERY_PROMPT", loadPrompt("rewrite-query.md")],
]
  .map(
    ([name, content]) =>
      `export const ${name} = \`${escapeForTemplateLiteral(content)}\`;`,
  )
  .join("\n\n")}

export function replacePromptVariables(
  prompt: string,
  variables: Record<string, string>
): string {
  let result = prompt;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(\`{{\${key}}}\`, "g"), value);
  }
  return result;
}

export function getPromptWithDate(prompt: string, currentDate?: string): string {
  const date = currentDate || new Date().toISOString().split("T")[0];
  return replacePromptVariables(prompt, { currentDate: date });
}
`;

  writeFileSync(join(PROMPTS_DIR, "prompts-embedded.ts"), output);
  console.log("✓ Generated packages/agents/prompts/prompts-embedded.ts");
}

main();
