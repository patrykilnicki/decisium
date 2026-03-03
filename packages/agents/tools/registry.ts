import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
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
} from "./index";
import { getComposioToolsForUser } from "../lib/composio";

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
    "email_search",
    {
      name: "email_search",
      category: "email",
      description: "Search Gmail messages",
      requiresAuth: true,
      enabled: false,
      authProvider: "google",
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
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

  toolRegistry.set("list_calendar_events", {
    tool: listCalendarEventsTool,
    category: "calendar",
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
      // Orchestrator: knowledge_search (unified), memory_search, vault_search for search; calendar, Composio, etc.
      config.includeMemorySearch = true;
      config.includeSupabaseStore = true;
      config.includeEmbeddingGenerator = true;
      config.includeTodoGenerator = true;
      config.includeListCalendarEvents = true;
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
  "vault_create_document",
  "vault_update_document",
] as const;

/**
 * Create userId-bound versions of tools that require it.
 * The LLM does not have access to the authenticated userId, so we inject it
 * to avoid FK violations (e.g. vault_documents.tenant_id) and security issues.
 */
function createToolsWithBoundUserId(userId: string): DynamicStructuredTool[] {
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
        "Search across all user knowledge: memory (summaries, events, history) AND Vault documents. Use for broad queries (e.g. 'what do I know about X'). When suggest_follow_up is true, call again with expandSearch: true for broader search. Set minResults when user expects at least N results.",
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
        "Search the user's Vault documents semantically. Use when the user asks about notes, documents, or knowledge stored in their Vault. Pass query.",
      schema: z.object({
        query: z
          .string()
          .describe("The search query to find relevant vault content"),
        maxResults: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(10)
          .describe("Maximum number of vault chunks to return"),
      }),
      func: async (args) =>
        vaultSearchTool.func({
          userId,
          query: args.query,
          maxResults: args.maxResults,
        }),
    }),
    new DynamicStructuredTool({
      name: "vault_create_document",
      description:
        "Create a new document in the user's Vault (personal knowledge base). Use when the user asks to save a summary, note, or any content to the Vault. Pass title and content_md (markdown). Optional: collection_id.",
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
          .describe("Optional Vault collection ID to store the document in"),
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
        "Update an existing document in the user's Vault. Use when the user asks to edit, update, or add to an existing document. Pass document_id and at least one of: title and/or content_md.",
      schema: z.object({
        document_id: z
          .string()
          .uuid()
          .describe(
            "The document ID to update (get from vault_search results or prior context)",
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
  ];
}

/**
 * Replace tools that require userId with bound versions when userId is provided.
 */
function applyUserIdBinding(
  tools: DynamicStructuredTool[],
  userId: string | undefined,
): DynamicStructuredTool[] {
  if (!userId) return tools;

  const boundByName = new Map(
    createToolsWithBoundUserId(userId).map((t) => [t.name, t]),
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
  excludeTools?: string[];
  enabledCategories?: ToolCategory[];
}): Promise<DynamicStructuredTool[]> {
  const baseTools = getToolsForAgent("orchestrator", {
    includeExternalTools: true,
    excludeTools: options?.excludeTools,
    enabledCategories: options?.enabledCategories,
  });

  const toolsWithUserId = applyUserIdBinding(baseTools, options?.userId);

  if (options?.userId) {
    const composioTools = await getComposioToolsForUser(options.userId, {
      callbackUrl: options.callbackUrl,
      toolkits: ["GOOGLECALENDAR", "GMAIL"],
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
