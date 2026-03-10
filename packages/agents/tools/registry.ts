import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { createHash } from "crypto";
import { createLLM } from "../lib/llm";
import { getTodayInTimezone } from "@/lib/datetime/user-timezone";
import {
  memorySearchTool,
  vaultSearchTool,
  knowledgeSearchTool,
  vaultCreateDocumentTool,
  vaultUpdateDocumentTool,
  supabaseStoreTool,
  embeddingGeneratorTool,
  generateTodoListTool,
  listCalendarEventsTool,
  fetchGmailEmailsTool,
  analyzeGmailEmailsTool,
  taskSearchTool,
} from "./index";
import { getComposioToolsForUser } from "../lib/composio";
import { getTaskContext } from "../lib/task-context";
import { createTaskEvent } from "@/lib/tasks/task-events";
import { createAdminClient } from "@/lib/supabase/admin";

// ═══════════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════

export type AgentType = "root" | "ask" | "summary" | "system" | "orchestrator";

/**
 * Tool categories for organization and routing decisions
 */
export type ToolCategory =
  | "memory"
  | "calendar"
  | "email"
  | "web"
  | "storage"
  | "utility";

/**
 * Configuration for external tool integrations
 */
export interface ExternalToolConfig {
  name: string;
  category: ToolCategory;
  description: string;
  requiresAuth: boolean;
  enabled: boolean;
  authProvider?: "google" | "microsoft" | "custom";
  scopes?: string[];
}

/**
 * Registry entry for a tool with metadata
 */
export interface ToolRegistryEntry {
  tool: DynamicStructuredTool;
  category: ToolCategory;
  isExternal: boolean;
  config?: ExternalToolConfig;
}

export interface ToolConfig {
  includeMemorySearch?: boolean;
  includeSupabaseStore?: boolean;
  includeEmbeddingGenerator?: boolean;
  includeTodoGenerator?: boolean;
  includeListCalendarEvents?: boolean;
  includeFetchGmailEmails?: boolean;
  includeExternalTools?: boolean;
  customTools?: DynamicStructuredTool[];
  enabledCategories?: ToolCategory[];
}

// ═══════════════════════════════════════════════════════════════
// TOOL REGISTRY
// ═══════════════════════════════════════════════════════════════

/**
 * Central registry of all available tools with metadata
 */
const toolRegistry: Map<string, ToolRegistryEntry> = new Map();

/**
 * External tools configuration (for future integrations)
 */
const externalToolConfigs: Map<string, ExternalToolConfig> = new Map([
  [
    "calendar_create",
    {
      name: "calendar_create",
      category: "calendar",
      description: "Create Google Calendar events",
      requiresAuth: true,
      enabled: false,
      authProvider: "google",
      scopes: ["https://www.googleapis.com/auth/calendar.events"],
    },
  ],
  [
    "email_draft",
    {
      name: "email_draft",
      category: "email",
      description: "Draft Gmail messages",
      requiresAuth: true,
      enabled: false,
      authProvider: "google",
      scopes: ["https://www.googleapis.com/auth/gmail.compose"],
    },
  ],
  [
    "web_search",
    {
      name: "web_search",
      category: "web",
      description: "Search the web for real-time information",
      requiresAuth: true,
      enabled: false,
      authProvider: "custom",
    },
  ],
]);

/**
 * Initialize the tool registry with core tools
 */
function initializeRegistry(): void {
  if (toolRegistry.size > 0) return; // Already initialized

  // Register core memory tools
  toolRegistry.set("memory_search", {
    tool: memorySearchTool,
    category: "memory",
    isExternal: false,
  });

  toolRegistry.set("vault_search", {
    tool: vaultSearchTool,
    category: "memory",
    isExternal: false,
  });

  toolRegistry.set("knowledge_search", {
    tool: knowledgeSearchTool,
    category: "memory",
    isExternal: false,
  });

  toolRegistry.set("vault_create_document", {
    tool: vaultCreateDocumentTool,
    category: "memory",
    isExternal: false,
  });

  toolRegistry.set("vault_update_document", {
    tool: vaultUpdateDocumentTool,
    category: "memory",
    isExternal: false,
  });

  toolRegistry.set("supabase_store", {
    tool: supabaseStoreTool,
    category: "storage",
    isExternal: false,
  });

  toolRegistry.set("embedding_generator", {
    tool: embeddingGeneratorTool,
    category: "utility",
    isExternal: false,
  });

  toolRegistry.set("generate_todo_list", {
    tool: generateTodoListTool,
    category: "utility",
    isExternal: false,
  });

  toolRegistry.set("task_search", {
    tool: taskSearchTool,
    category: "memory",
    isExternal: false,
  });

  toolRegistry.set("list_calendar_events", {
    tool: listCalendarEventsTool,
    category: "calendar",
    isExternal: false,
  });

  toolRegistry.set("fetch_gmail_emails", {
    tool: fetchGmailEmailsTool,
    category: "email",
    isExternal: false,
  });

  toolRegistry.set("analyze_gmail_emails", {
    tool: analyzeGmailEmailsTool,
    category: "email",
    isExternal: false,
  });
}

// Initialize on module load
initializeRegistry();

// ═══════════════════════════════════════════════════════════════
// REGISTRY MANAGEMENT FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Register a new tool in the registry
 */
export function registerTool(
  name: string,
  tool: DynamicStructuredTool,
  category: ToolCategory,
  config?: ExternalToolConfig,
): void {
  toolRegistry.set(name, {
    tool,
    category,
    isExternal: !!config,
    config,
  });
}

/**
 * Unregister a tool from the registry
 */
export function unregisterTool(name: string): boolean {
  return toolRegistry.delete(name);
}

/**
 * Get a tool by name from the registry
 */
export function getTool(name: string): DynamicStructuredTool | undefined {
  return toolRegistry.get(name)?.tool;
}

/**
 * Get tool metadata by name
 */
export function getToolMetadata(name: string): ToolRegistryEntry | undefined {
  return toolRegistry.get(name);
}

/**
 * Get all tools in a specific category
 */
export function getToolsByCategory(
  category: ToolCategory,
): DynamicStructuredTool[] {
  const tools: DynamicStructuredTool[] = [];
  for (const entry of toolRegistry.values()) {
    if (entry.category === category) {
      tools.push(entry.tool);
    }
  }
  return tools;
}

/**
 * Get all enabled external tools
 */
export function getEnabledExternalTools(): DynamicStructuredTool[] {
  const tools: DynamicStructuredTool[] = [];
  for (const entry of toolRegistry.values()) {
    if (entry.isExternal && entry.config?.enabled) {
      tools.push(entry.tool);
    }
  }
  return tools;
}

/**
 * Check if an external tool is enabled
 */
export function isExternalToolEnabled(name: string): boolean {
  const config = externalToolConfigs.get(name);
  return config?.enabled ?? false;
}

/**
 * Enable an external tool (requires the tool to be registered first)
 */
export function enableExternalTool(name: string): boolean {
  const config = externalToolConfigs.get(name);
  if (config) {
    config.enabled = true;
    return true;
  }
  return false;
}

/**
 * Disable an external tool
 */
export function disableExternalTool(name: string): boolean {
  const config = externalToolConfigs.get(name);
  if (config) {
    config.enabled = false;
    return true;
  }
  return false;
}

/**
 * Get external tool configuration
 */
export function getExternalToolConfig(
  name: string,
): ExternalToolConfig | undefined {
  return externalToolConfigs.get(name);
}

/**
 * Get all external tool configurations
 */
export function getAllExternalToolConfigs(): ExternalToolConfig[] {
  return Array.from(externalToolConfigs.values());
}

// ═══════════════════════════════════════════════════════════════
// TOOL RETRIEVAL FUNCTIONS (Enhanced)
// ═══════════════════════════════════════════════════════════════

/**
 * Get default tools for agents
 * These are the standard tools available to most agents
 */
export function getDefaultTools(
  config: ToolConfig = {},
): DynamicStructuredTool[] {
  const tools: DynamicStructuredTool[] = [];

  if (config.includeMemorySearch !== false) {
    tools.push(memorySearchTool);
  }

  tools.push(knowledgeSearchTool);
  tools.push(vaultSearchTool);
  tools.push(taskSearchTool);
  tools.push(vaultCreateDocumentTool);
  tools.push(vaultUpdateDocumentTool);

  if (config.includeSupabaseStore !== false) {
    tools.push(supabaseStoreTool);
  }

  if (config.includeEmbeddingGenerator !== false) {
    tools.push(embeddingGeneratorTool);
  }

  if (config.includeTodoGenerator !== false) {
    tools.push(generateTodoListTool);
  }

  if (config.includeListCalendarEvents !== false) {
    tools.push(listCalendarEventsTool);
  }

  if (config.includeFetchGmailEmails !== false) {
    tools.push(fetchGmailEmailsTool);
  }

  if (config.includeFetchGmailEmails !== false) {
    tools.push(analyzeGmailEmailsTool);
  }

  // Include enabled external tools if requested
  if (config.includeExternalTools) {
    const externalTools = getEnabledExternalTools();
    tools.push(...externalTools);
  }

  // Filter by enabled categories if specified
  if (config.enabledCategories && config.enabledCategories.length > 0) {
    const filteredTools = tools.filter((tool) => {
      const metadata = getToolMetadata(tool.name);
      return metadata && config.enabledCategories!.includes(metadata.category);
    });
    tools.length = 0;
    tools.push(...filteredTools);
  }

  if (config.customTools) {
    tools.push(...config.customTools);
  }

  return tools;
}

/**
 * Get tools for a specific agent type
 */
export function getToolsForAgent(
  agentType: AgentType,
  options?: {
    customTools?: DynamicStructuredTool[];
    excludeTools?: string[];
    includeExternalTools?: boolean;
    enabledCategories?: ToolCategory[];
  },
): DynamicStructuredTool[] {
  const config: ToolConfig = {
    customTools: options?.customTools,
    includeExternalTools: options?.includeExternalTools,
    enabledCategories: options?.enabledCategories,
  };

  // Agent-specific tool configurations
  switch (agentType) {
    case "root":
    case "ask":
      // Root/Ask agents need all tools
      config.includeMemorySearch = true;
      config.includeSupabaseStore = true;
      config.includeEmbeddingGenerator = true;
      config.includeTodoGenerator = false;
      break;

    case "orchestrator":
      // Orchestrator: knowledge_search (unified), memory_search, vault_search for search; calendar, Gmail fetch, Composio, etc.
      config.includeMemorySearch = true;
      config.includeSupabaseStore = true;
      config.includeEmbeddingGenerator = true;
      config.includeTodoGenerator = true;
      config.includeListCalendarEvents = true;
      config.includeFetchGmailEmails = true;
      config.includeExternalTools = true;
      break;

    case "summary":
      config.includeMemorySearch = true;
      config.includeSupabaseStore = true;
      config.includeEmbeddingGenerator = false;
      config.includeTodoGenerator = false;
      config.includeListCalendarEvents = false;
      break;

    case "system":
      config.includeMemorySearch = false;
      config.includeSupabaseStore = false;
      config.includeEmbeddingGenerator = false;
      config.includeTodoGenerator = false;
      config.includeListCalendarEvents = false;
      break;

    default:
      // Default: include all tools
      break;
  }

  let tools = getDefaultTools(config);

  // Filter out excluded tools
  if (options?.excludeTools && options.excludeTools.length > 0) {
    tools = tools.filter((tool) => !options.excludeTools!.includes(tool.name));
  }

  return tools;
}

const TOOLS_REQUIRING_USER_ID = [
  "memory_search",
  "knowledge_search",
  "vault_search",
  "task_search",
  "vault_create_document",
  "vault_update_document",
  "fetch_gmail_emails",
  "analyze_gmail_emails",
] as const;

interface BoundUserToolContext {
  userId: string;
  threadId?: string;
  preferredModel?: string;
  userMessage?: string;
  currentDate?: string;
  timezone?: string;
}

function toGmailDateFormat(yyyyMmDd: string): string {
  return yyyyMmDd.replace(/-/g, "/");
}

function addDays(yyyyMmDd: string, days: number): string {
  const [year, month, day] = yyyyMmDd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getStartOfMonth(yyyyMmDd: string): string {
  const [year, month] = yyyyMmDd.split("-").map(Number);
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function addMonths(yyyyMmDd: string, months: number): string {
  const [year, month, day] = yyyyMmDd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, day));
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getStartOfWeekMonday(yyyyMmDd: string): string {
  const [year, month, day] = yyyyMmDd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay(); // 0 Sunday ... 6 Saturday
  const diffToMonday = weekday === 0 ? -6 : 1 - weekday;
  date.setUTCDate(date.getUTCDate() + diffToMonday);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getZonedDateParts(
  timestampMs: number,
  timezone: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(timestampMs));

  return {
    year: Number(parts.find((p) => p.type === "year")?.value ?? 0),
    month: Number(parts.find((p) => p.type === "month")?.value ?? 1),
    day: Number(parts.find((p) => p.type === "day")?.value ?? 1),
    hour: Number(parts.find((p) => p.type === "hour")?.value ?? 0),
    minute: Number(parts.find((p) => p.type === "minute")?.value ?? 0),
    second: Number(parts.find((p) => p.type === "second")?.value ?? 0),
  };
}

function getUtcEpochForLocalMidnight(
  yyyyMmDd: string,
  timezone: string,
): number {
  const [year, month, day] = yyyyMmDd.split("-").map(Number);
  const targetAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  let candidate = targetAsUtc;

  // Converges quickly for timezone offset and DST transitions.
  for (let i = 0; i < 4; i += 1) {
    const zoned = getZonedDateParts(candidate, timezone);
    const zonedAsUtc = Date.UTC(
      zoned.year,
      zoned.month - 1,
      zoned.day,
      zoned.hour,
      zoned.minute,
      zoned.second,
    );
    candidate += targetAsUtc - zonedAsUtc;
  }

  return Math.floor(candidate / 1000);
}

function stripRelativeDateFilters(query: string): string {
  return query
    .replace(/\b(after|before|older_than|newer_than):\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const relativeEmailWindowSchema = z.object({
  window: z.enum([
    "none",
    "today",
    "yesterday",
    "this_week",
    "last_week",
    "this_month",
    "last_month",
  ]),
});

type RelativeEmailWindow = z.infer<typeof relativeEmailWindowSchema>["window"];
interface RelativeWindowCacheEntry {
  value: RelativeEmailWindow;
  expiresAt: number;
}

const RELATIVE_WINDOW_CACHE_TTL_MS = 10 * 60 * 1000;
const RELATIVE_WINDOW_CACHE_MAX_ENTRIES = 500;
const relativeEmailWindowCache = new Map<string, RelativeWindowCacheEntry>();

function createRelativeWindowCacheKey(params: {
  threadId?: string;
  userMessage: string;
  preferredModel?: string;
}): string | null {
  if (!params.threadId?.trim()) return null;
  const normalizedMessage = params.userMessage.trim().replace(/\s+/g, " ");
  if (!normalizedMessage) return null;
  const hash = createHash("sha256")
    .update(normalizedMessage)
    .digest("hex")
    .slice(0, 16);
  return `email-window:${params.threadId}:${params.preferredModel ?? "default"}:${hash}`;
}

function getCachedRelativeWindow(cacheKey: string): RelativeEmailWindow | null {
  const cached = relativeEmailWindowCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    relativeEmailWindowCache.delete(cacheKey);
    return null;
  }
  return cached.value;
}

function setCachedRelativeWindow(
  cacheKey: string,
  value: RelativeEmailWindow,
): void {
  if (relativeEmailWindowCache.size >= RELATIVE_WINDOW_CACHE_MAX_ENTRIES) {
    const oldestKey = relativeEmailWindowCache.keys().next().value as
      | string
      | undefined;
    if (oldestKey) relativeEmailWindowCache.delete(oldestKey);
  }
  relativeEmailWindowCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + RELATIVE_WINDOW_CACHE_TTL_MS,
  });
}

async function logEmailGuardrailToDb(payload: {
  relative_window: string;
  cache_hit?: boolean;
  start_date?: string;
  end_date?: string;
  timezone?: string;
  event_key_suffix: "classification" | "applied";
}): Promise<void> {
  const ctx = getTaskContext();
  if (!ctx?.taskId || !ctx.sessionId || !ctx.userId) return;
  try {
    const client = createAdminClient();
    await createTaskEvent(client, {
      taskId: ctx.taskId,
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      eventType: "email_guardrail",
      nodeKey: "orchestrator.invoke",
      eventKeySuffix: payload.event_key_suffix,
      payload: {
        relative_window: payload.relative_window,
        ...(payload.cache_hit !== undefined && { cache_hit: payload.cache_hit }),
        ...(payload.start_date && { start_date: payload.start_date }),
        ...(payload.end_date && { end_date: payload.end_date }),
        ...(payload.timezone && { timezone: payload.timezone }),
      },
    });
  } catch (err) {
    console.warn("[email-guardrail] Failed to write task event:", err);
  }
}

async function inferRelativeEmailWindow(params: {
  userMessage?: string;
  preferredModel?: string;
  threadId?: string;
}): Promise<RelativeEmailWindow> {
  if (!params.userMessage?.trim()) return "none";

  const cacheKey = createRelativeWindowCacheKey({
    threadId: params.threadId,
    userMessage: params.userMessage,
    preferredModel: params.preferredModel,
  });
  if (cacheKey) {
    const cached = getCachedRelativeWindow(cacheKey);
    if (cached) {
      await logEmailGuardrailToDb({
        relative_window: cached,
        cache_hit: true,
        event_key_suffix: "classification",
      });
      return cached;
    }
  }

  try {
    const llm = createLLM({
      model: params.preferredModel || process.env.LLM_MODEL || "openai/gpt-4o",
      temperature: 0,
      maxTokens: 40,
    }).withStructuredOutput(relativeEmailWindowSchema);

    const result = await llm.invoke([
      {
        role: "system" as const,
        content:
          "Classify the requested email time window from the user message. Detect intent across any language. Return one enum value. If no explicit relative period is requested, return 'none'.",
      },
      {
        role: "user" as const,
        content: params.userMessage,
      },
    ]);

    const resolved = result.window;
    if (cacheKey) setCachedRelativeWindow(cacheKey, resolved);
    await logEmailGuardrailToDb({
      relative_window: resolved,
      cache_hit: false,
      event_key_suffix: "classification",
    });
    return resolved;
  } catch {
    await logEmailGuardrailToDb({
      relative_window: "none",
      cache_hit: false,
      event_key_suffix: "classification",
    });
    return "none";
  }
}

async function resolveStrictRelativeEmailQuery(params: {
  query: string;
  threadId?: string;
  preferredModel?: string;
  userMessage?: string;
  currentDate?: string;
  timezone?: string;
}): Promise<string> {
  const window = await inferRelativeEmailWindow({
    userMessage: params.userMessage,
    preferredModel: params.preferredModel,
    threadId: params.threadId,
  });
  if (window === "none") return params.query;

  const timezone = params.timezone ?? "UTC";
  const baseDate =
    params.currentDate ?? getTodayInTimezone(timezone, new Date());
  let startDate = baseDate;
  let endDate = addDays(baseDate, 1);

  if (window === "yesterday") {
    startDate = addDays(baseDate, -1);
    endDate = addDays(startDate, 1);
  } else if (window === "today") {
    startDate = baseDate;
    endDate = addDays(startDate, 1);
  } else if (window === "last_week") {
    endDate = getStartOfWeekMonday(baseDate);
    startDate = addDays(endDate, -7);
  } else if (window === "this_week") {
    startDate = getStartOfWeekMonday(baseDate);
    endDate = addDays(startDate, 7);
  } else if (window === "last_month") {
    endDate = getStartOfMonth(baseDate);
    startDate = getStartOfMonth(addMonths(baseDate, -1));
  } else if (window === "this_month") {
    startDate = getStartOfMonth(baseDate);
    endDate = getStartOfMonth(addMonths(baseDate, 1));
  }

  await logEmailGuardrailToDb({
    relative_window: window,
    start_date: startDate,
    end_date: endDate,
    timezone,
    event_key_suffix: "applied",
  });

  const startEpoch = getUtcEpochForLocalMidnight(startDate, timezone);
  const endEpoch = getUtcEpochForLocalMidnight(endDate, timezone);
  const strictWindow = `after:${startEpoch} before:${endEpoch}`;
  const cleanedQuery = stripRelativeDateFilters(params.query);

  if (!cleanedQuery) return strictWindow;
  const legacyDateWindow = `after:${toGmailDateFormat(startDate)} before:${toGmailDateFormat(endDate)}`;
  return `${strictWindow} ${legacyDateWindow} ${cleanedQuery}`.trim();
}

/**
 * Create userId-bound versions of tools that require it.
 * The LLM does not have access to the authenticated userId, so we inject it
 * to avoid FK violations (e.g. vault_documents.tenant_id) and security issues.
 */
function createToolsWithBoundUserId(
  context: BoundUserToolContext,
): DynamicStructuredTool[] {
  const {
    userId,
    threadId,
    preferredModel,
    userMessage,
    currentDate,
    timezone,
  } = context;
  return [
    new DynamicStructuredTool({
      name: "memory_search",
      description:
        "Search user's history semantically. Pass query and maxResults. You must set maxResults (how many results to fetch) based on user intent; set minResults when user expects 'at least N'. When suggest_follow_up is true, offer to broaden the search or try different keywords.",
      schema: z.object({
        query: z
          .string()
          .describe("The search query to find relevant memories"),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(60)
          .describe(
            "How many results to fetch. Set from user intent: 5-15 for specific questions, 20-50 for 'list all X' or broad queries.",
          ),
        minResults: z
          .number()
          .int()
          .min(1)
          .max(60)
          .optional()
          .describe(
            "Optional. Minimum results you expect. When total_found < minResults, suggest_follow_up will be true.",
          ),
      }),
      func: async (args) =>
        memorySearchTool.func({
          userId,
          query: args.query,
          maxResults: args.maxResults,
          minResults: args.minResults,
        }),
    }),
    new DynamicStructuredTool({
      name: "knowledge_search",
      description:
        "Search across all user knowledge: memory (summaries, events, history) AND Collections documents. Use for broad queries (e.g. 'what do I know about X'). When suggest_follow_up is true, call again with expandSearch: true for broader search. Set minResults when user expects at least N results.",
      schema: z.object({
        query: z.string().describe("The search query"),
        maxResults: z
          .number()
          .int()
          .min(5)
          .max(60)
          .default(30)
          .describe("Maximum total results to return (from both sources)"),
        minResults: z
          .number()
          .int()
          .min(1)
          .max(60)
          .optional()
          .describe(
            "When total_found < minResults, suggest_follow_up is true. Use for 'list all X' or when user expects many results.",
          ),
        expandSearch: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "When true, use lower similarity threshold (0.25) and higher limits for broader retrieval. Use when initial search returned few results or user wants comprehensive coverage.",
          ),
      }),
      func: async (args) =>
        knowledgeSearchTool.func({
          userId,
          query: args.query,
          maxResults: args.maxResults,
          minResults: args.minResults,
          expandSearch: args.expandSearch,
        }),
    }),
    new DynamicStructuredTool({
      name: "vault_search",
      description:
        "Search the user's Collections documents semantically. Use when the user asks about notes, documents, or knowledge stored in their Collections. Pass query.",
      schema: z.object({
        query: z
          .string()
          .describe("The search query to find relevant Collections content"),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(10)
          .describe("Maximum number of Collections chunks to return"),
      }),
      func: async (args) =>
        vaultSearchTool.func({
          userId,
          query: args.query,
          maxResults: args.maxResults,
        }),
    }),
    new DynamicStructuredTool({
      name: "task_search",
      description:
        "Search user todo tasks semantically/lexically. Use for task-specific questions, status checks, and planning.",
      schema: z.object({
        query: z.string().describe("Task query"),
        maxResults: z.number().int().min(1).max(50).default(20),
      }),
      func: async (args) =>
        taskSearchTool.func({
          userId,
          query: args.query,
          maxResults: args.maxResults,
        }),
    }),
    new DynamicStructuredTool({
      name: "vault_create_document",
      description:
        "Create a new document in the user's Collections (personal knowledge base). Use when the user asks to save a summary, note, or any content to Collections. Pass title and content_md (markdown). Optional: collection_id.",
      schema: z.object({
        title: z
          .string()
          .describe("Short document title (e.g. 'Meeting summary Mar 3 2025')"),
        content_md: z
          .string()
          .describe(
            "Full document content in Markdown (summary, notes, or text to save)",
          ),
        collection_id: z
          .string()
          .uuid()
          .optional()
          .describe("Optional collection ID to store the document in"),
      }),
      func: async (args) =>
        vaultCreateDocumentTool.func({
          userId,
          title: args.title,
          content_md: args.content_md,
          collection_id: args.collection_id,
        }),
    }),
    new DynamicStructuredTool({
      name: "vault_update_document",
      description:
        "Update an existing document in the user's Collections. Use when the user asks to edit, update, or add to an existing document. Pass document_id and at least one of: title and/or content_md.",
      schema: z.object({
        document_id: z
          .string()
          .uuid()
          .describe(
            "The document ID to update (get from vault_search or prior context)",
          ),
        title: z
          .string()
          .optional()
          .describe("New title (optional; omit to keep current title)"),
        content_md: z
          .string()
          .optional()
          .describe(
            "New full markdown content (optional; omit to keep current content). When provided, replaces entire content and re-indexes.",
          ),
      }),
      func: async (args) =>
        vaultUpdateDocumentTool.func({
          userId,
          document_id: args.document_id,
          title: args.title,
          content_md: args.content_md,
        }),
    }),
    new DynamicStructuredTool({
      name: "fetch_gmail_emails",
      description: fetchGmailEmailsTool.description,
      schema: z.object({
        query: z
          .string()
          .describe(
            "Gmail search query (e.g. 'after:2026/3/1 before:2026/3/2', 'is:unread', 'from:someone@example.com'). Use for listing, summarizing, or counting emails.",
          ),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe(
            "Cap on messages to fetch. Default 30 when omitted. Use 20-50 to keep responses reliable; user can ask for more.",
          ),
        withThreadContext: z
          .boolean()
          .optional()
          .default(true)
          .describe(
            "When true, include message/thread content for each email so you can review and summarize accurately. Set true for list/summarize/count requests.",
          ),
      }),
      func: async (args) =>
        fetchGmailEmailsTool.func({
          userId,
          query: args.query,
          maxResults: args.maxResults ?? 30,
          withThreadContext: args.withThreadContext,
        }),
    }),
    new DynamicStructuredTool({
      name: "analyze_gmail_emails",
      description: analyzeGmailEmailsTool.description,
      schema: z.object({
        query: z
          .string()
          .describe(
            "Gmail search query (e.g. 'after:2026/3/1 before:2026/3/2', 'is:unread').",
          ),
        analysisFocus: z
          .string()
          .describe(
            "What the user wants to know (e.g. 'Summarize and highlight what needs action').",
          ),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(250)
          .optional()
          .default(100)
          .describe("Max emails to fetch and analyze."),
      }),
      func: async (args) =>
        analyzeGmailEmailsTool.func({
          userId,
          preferredModel,
          query: await resolveStrictRelativeEmailQuery({
            query: args.query,
            threadId,
            preferredModel,
            userMessage,
            currentDate,
            timezone,
          }),
          analysisFocus: args.analysisFocus,
          maxResults: args.maxResults,
        }),
    }),
  ];
}

/**
 * Replace tools that require userId with bound versions when userId is provided.
 */
function applyUserIdBinding(
  tools: DynamicStructuredTool[],
  context: BoundUserToolContext | undefined,
): DynamicStructuredTool[] {
  if (!context?.userId) return tools;

  const boundByName = new Map(
    createToolsWithBoundUserId(context).map((t) => [t.name, t]),
  );

  return tools.map((tool) => {
    if (
      TOOLS_REQUIRING_USER_ID.includes(
        tool.name as (typeof TOOLS_REQUIRING_USER_ID)[number],
      )
    ) {
      return boundByName.get(tool.name) ?? tool;
    }
    return tool;
  });
}

interface OrchestratorIntentToolConfig {
  enabledCategories?: ToolCategory[];
  excludeTools?: string[];
  composioToolkits?: string[];
}

const toolIntentSchema = z.object({
  needsEmail: z.boolean(),
  needsCalendar: z.boolean(),
  needsTodo: z.boolean(),
  needsKnowledge: z.boolean(),
});

type ToolIntent = z.infer<typeof toolIntentSchema>;
interface IntentCacheEntry {
  value: OrchestratorIntentToolConfig;
  expiresAt: number;
}

const INTENT_CACHE_TTL_MS = 5 * 60 * 1000;
const INTENT_CACHE_MAX_ENTRIES = 400;
const orchestratorIntentCache = new Map<string, IntentCacheEntry>();

function createIntentCacheKey(params: {
  threadId?: string;
  userMessage: string;
  preferredModel?: string;
}): string | null {
  if (!params.threadId?.trim()) return null;
  const normalizedMessage = params.userMessage.trim().replace(/\s+/g, " ");
  if (!normalizedMessage) return null;
  const hash = createHash("sha256")
    .update(normalizedMessage)
    .digest("hex")
    .slice(0, 16);
  return `${params.threadId}:${params.preferredModel ?? "default"}:${hash}`;
}

function getCachedIntentConfig(
  cacheKey: string,
): OrchestratorIntentToolConfig | null {
  const cached = orchestratorIntentCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    orchestratorIntentCache.delete(cacheKey);
    return null;
  }
  return cached.value;
}

function setCachedIntentConfig(
  cacheKey: string,
  value: OrchestratorIntentToolConfig,
): void {
  if (orchestratorIntentCache.size >= INTENT_CACHE_MAX_ENTRIES) {
    const oldestKey = orchestratorIntentCache.keys().next().value as
      | string
      | undefined;
    if (oldestKey) orchestratorIntentCache.delete(oldestKey);
  }
  orchestratorIntentCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + INTENT_CACHE_TTL_MS,
  });
}

function inferToolIntentConfigFromFlags(
  intent: ToolIntent,
): OrchestratorIntentToolConfig {
  if (intent.needsTodo) {
    return {
      enabledCategories: ["utility", "email", "calendar", "memory"],
      composioToolkits: ["GOOGLECALENDAR", "GMAIL"],
    };
  }

  if (intent.needsEmail && !intent.needsCalendar) {
    return {
      enabledCategories: ["email", "memory", "utility"],
      composioToolkits: ["GMAIL"],
      excludeTools: ["list_calendar_events"],
    };
  }

  if (intent.needsCalendar && !intent.needsEmail) {
    return {
      enabledCategories: ["calendar", "memory", "utility"],
      composioToolkits: ["GOOGLECALENDAR"],
      excludeTools: ["fetch_gmail_emails", "analyze_gmail_emails"],
    };
  }

  if (intent.needsKnowledge && !intent.needsEmail && !intent.needsCalendar) {
    return {
      enabledCategories: ["memory", "utility"],
      composioToolkits: [],
      excludeTools: [
        "fetch_gmail_emails",
        "analyze_gmail_emails",
        "list_calendar_events",
      ],
    };
  }

  return {};
}

function inferIntentHeuristicsFallback(
  userMessage?: string,
): OrchestratorIntentToolConfig {
  if (!userMessage?.trim()) return {};

  const text = userMessage.toLowerCase();

  const hasEmailIntent =
    /\b(mail|email|gmail|inbox|message|messages|reply|replies)\b/.test(text);
  const hasCalendarIntent =
    /\b(calendar|meeting|meetings|agenda|event|events|schedule|scheduled|appointment|appointments)\b/.test(
      text,
    );
  const hasTaskIntent = /\b(todo|to-?do|task|tasks|plan|planning)\b/.test(text);
  const hasKnowledgeIntent =
    /\b(remember|history|memory|note|notes|vault|collections|knowledge)\b/.test(
      text,
    );

  return inferToolIntentConfigFromFlags({
    needsEmail: hasEmailIntent,
    needsCalendar: hasCalendarIntent,
    needsTodo: hasTaskIntent,
    needsKnowledge: hasKnowledgeIntent,
  });
}

async function inferOrchestratorIntentToolConfig(
  userMessage?: string,
  preferredModel?: string,
  threadId?: string,
): Promise<OrchestratorIntentToolConfig> {
  if (!userMessage?.trim()) return {};

  const cacheKey = createIntentCacheKey({
    threadId,
    userMessage,
    preferredModel,
  });
  if (cacheKey) {
    const cached = getCachedIntentConfig(cacheKey);
    if (cached) return cached;
  }

  try {
    const llm = createLLM({
      model: preferredModel || process.env.LLM_MODEL || "openai/gpt-4o",
      temperature: 0,
      maxTokens: 120,
    }).withStructuredOutput(toolIntentSchema);

    const intent = await llm.invoke([
      {
        role: "system" as const,
        content:
          "Classify which data/tool domains are needed for the user request. Set booleans only. Use conservative true values only when clearly needed.",
      },
      {
        role: "user" as const,
        content: `Request: ${userMessage}`,
      },
    ]);

    const resolved = inferToolIntentConfigFromFlags(intent);
    if (cacheKey) setCachedIntentConfig(cacheKey, resolved);
    return resolved;
  } catch {
    const fallback = inferIntentHeuristicsFallback(userMessage);
    if (cacheKey) setCachedIntentConfig(cacheKey, fallback);
    return fallback;
  }
}

/**
 * Get all tools for the orchestrator (includes Composio + internal tools).
 * When userId is provided and Composio is configured, merges Composio session
 * tools (meta-tools: SEARCH_TOOLS, MANAGE_CONNECTIONS, MULTI_EXECUTE_TOOL) per
 * [Composio Users & Sessions](https://docs.composio.dev/docs/users-and-sessions).
 * When userId is provided, injects it into vault/memory tools so the LLM does
 * not need to (and cannot) pass it—avoiding FK violations and security issues.
 *
 * @param options.userId - Supabase user ID; when set, Composio tools are included and vault/memory tools are user-bound
 * @param options.callbackUrl - Optional callback URL for Composio in-chat auth redirect
 */
export async function getOrchestratorTools(options?: {
  userId?: string;
  callbackUrl?: string;
  threadId?: string;
  userMessage?: string;
  currentDate?: string;
  timezone?: string;
  preferredModel?: string;
  excludeTools?: string[];
  enabledCategories?: ToolCategory[];
  composioToolkits?: string[];
}): Promise<DynamicStructuredTool[]> {
  const intentConfig = await inferOrchestratorIntentToolConfig(
    options?.userMessage,
    options?.preferredModel,
    options?.threadId,
  );
  const enabledCategories =
    options?.enabledCategories ?? intentConfig.enabledCategories;
  const excludeTools = Array.from(
    new Set([
      ...(options?.excludeTools ?? []),
      ...(intentConfig.excludeTools ?? []),
    ]),
  );
  const baseTools = getToolsForAgent("orchestrator", {
    includeExternalTools: true,
    excludeTools,
    enabledCategories,
  });

  const toolsWithUserId = applyUserIdBinding(baseTools, {
    userId: options?.userId ?? "",
    threadId: options?.threadId,
    preferredModel: options?.preferredModel,
    userMessage: options?.userMessage,
    currentDate: options?.currentDate,
    timezone: options?.timezone,
  });

  if (options?.userId) {
    const toolkits = options?.composioToolkits ?? intentConfig.composioToolkits;
    const composioTools = await getComposioToolsForUser(options.userId, {
      callbackUrl: options.callbackUrl,
      toolkits: toolkits ?? ["GOOGLECALENDAR", "GMAIL"],
    });
    return [...toolsWithUserId, ...composioTools];
  }

  return toolsWithUserId;
}

/**
 * @deprecated Use getOrchestratorTools({ userId }) instead—it injects userId
 * into vault/memory tools automatically via applyUserIdBinding.
 */
export function createToolWithContext<T extends DynamicStructuredTool>(
  tool: T,
  _userId: string,
): T {
  return tool;
}
