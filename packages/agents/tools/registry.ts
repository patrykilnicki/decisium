import type { DynamicStructuredTool } from "@langchain/core/tools";
import {
  memorySearchTool,
  supabaseStoreTool,
  embeddingGeneratorTool,
} from "./index";

// ═══════════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════

export type AgentType = "daily" | "root" | "ask" | "summary" | "system" | "orchestrator";

/**
 * Tool categories for organization and routing decisions
 */
export type ToolCategory = "memory" | "calendar" | "email" | "web" | "storage" | "utility";

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
  ["calendar_search", {
    name: "calendar_search",
    category: "calendar",
    description: "Search Google Calendar for events",
    requiresAuth: true,
    enabled: false,
    authProvider: "google",
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
  }],
  ["calendar_create", {
    name: "calendar_create",
    category: "calendar",
    description: "Create Google Calendar events",
    requiresAuth: true,
    enabled: false,
    authProvider: "google",
    scopes: ["https://www.googleapis.com/auth/calendar.events"],
  }],
  ["email_search", {
    name: "email_search",
    category: "email",
    description: "Search Gmail messages",
    requiresAuth: true,
    enabled: false,
    authProvider: "google",
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
  }],
  ["email_draft", {
    name: "email_draft",
    category: "email",
    description: "Draft Gmail messages",
    requiresAuth: true,
    enabled: false,
    authProvider: "google",
    scopes: ["https://www.googleapis.com/auth/gmail.compose"],
  }],
  ["web_search", {
    name: "web_search",
    category: "web",
    description: "Search the web for real-time information",
    requiresAuth: true,
    enabled: false,
    authProvider: "custom",
  }],
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
  config?: ExternalToolConfig
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
export function getToolsByCategory(category: ToolCategory): DynamicStructuredTool[] {
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
export function getExternalToolConfig(name: string): ExternalToolConfig | undefined {
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
  config: ToolConfig = {}
): DynamicStructuredTool[] {
  const tools: DynamicStructuredTool[] = [];

  if (config.includeMemorySearch !== false) {
    tools.push(memorySearchTool);
  }

  if (config.includeSupabaseStore !== false) {
    tools.push(supabaseStoreTool);
  }

  if (config.includeEmbeddingGenerator !== false) {
    tools.push(embeddingGeneratorTool);
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
  }
): DynamicStructuredTool[] {
  const config: ToolConfig = {
    customTools: options?.customTools,
    includeExternalTools: options?.includeExternalTools,
    enabledCategories: options?.enabledCategories,
  };

  // Agent-specific tool configurations
  switch (agentType) {
    case "daily":
      // Daily agent needs all tools for memory search and storage
      config.includeMemorySearch = true;
      config.includeSupabaseStore = true;
      config.includeEmbeddingGenerator = true;
      break;

    case "root":
    case "ask":
      // Root/Ask agents need all tools
      config.includeMemorySearch = true;
      config.includeSupabaseStore = true;
      config.includeEmbeddingGenerator = true;
      break;

    case "orchestrator":
      // Orchestrator agent has access to ALL tools including external
      config.includeMemorySearch = true;
      config.includeSupabaseStore = true;
      config.includeEmbeddingGenerator = true;
      config.includeExternalTools = true;
      break;

    case "summary":
      // Summary agents need memory search but may not need store/embedding
      config.includeMemorySearch = true;
      config.includeSupabaseStore = true;
      config.includeEmbeddingGenerator = false;
      break;

    case "system":
      // System agents typically don't need tools
      config.includeMemorySearch = false;
      config.includeSupabaseStore = false;
      config.includeEmbeddingGenerator = false;
      break;

    default:
      // Default: include all tools
      break;
  }

  let tools = getDefaultTools(config);

  // Filter out excluded tools
  if (options?.excludeTools && options.excludeTools.length > 0) {
    tools = tools.filter(
      (tool) => !options.excludeTools!.includes(tool.name)
    );
  }

  return tools;
}

/**
 * Get all tools for the orchestrator (includes all enabled external tools)
 */
export function getOrchestratorTools(
  options?: {
    excludeTools?: string[];
    enabledCategories?: ToolCategory[];
  }
): DynamicStructuredTool[] {
  return getToolsForAgent("orchestrator", {
    includeExternalTools: true,
    excludeTools: options?.excludeTools,
    enabledCategories: options?.enabledCategories,
  });
}

/**
 * Create a tool wrapper that injects user context
 * This is useful when tools need userId but it's not in the schema
 */
export function createToolWithContext<T extends DynamicStructuredTool>(
  tool: T,
  userId: string
): T {
  // Note: This is a conceptual wrapper
  // In practice, tools should accept userId as a parameter
  // This function documents the pattern but doesn't modify the tool
  // Tools should be designed to accept userId in their schema
  return tool;
}
