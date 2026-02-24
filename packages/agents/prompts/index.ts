/**
 * Agent prompts - uses embedded prompts for serverless deployment (Vercel).
 * Edit .md files and run `pnpm exec tsx scripts/embed-prompts.ts` to regenerate.
 */
export {
  MAIN_AGENT_SYSTEM_PROMPT,
  ASK_SUBAGENT_SYSTEM_PROMPT,
  ROOT_AGENT_SYSTEM_PROMPT,
  ORCHESTRATOR_SYSTEM_PROMPT,
  ROUTER_SYSTEM_PROMPT,
  replacePromptVariables,
  getPromptWithDate,
} from "./prompts-embedded";
