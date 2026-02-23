/**
 * Composio integration for AI agents.
 *
 * Uses Supabase user IDs as Composio user_id so each app user's
 * connected accounts (Gmail, GitHub, etc.) are isolated.
 *
 * @see https://docs.composio.dev/docs/users-and-sessions
 */

import type { DynamicStructuredTool } from "@langchain/core/tools";
import { Composio } from "@composio/core";
import { LangchainProvider } from "@composio/langchain";

let composioClient: Composio | null = null;
let composioServerClient: Composio | null = null;

function getComposioClient(): Composio | null {
  if (composioClient) return composioClient;

  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) {
    return null;
  }

  try {
    composioClient = new Composio({
      apiKey,
      provider: new LangchainProvider(),
    }) as unknown as Composio;
    return composioClient;
  } catch (err) {
    console.warn("[composio] Failed to initialize Composio client:", err);
    return null;
  }
}

/** Server-side client for connect and execute (no Langchain provider) */
function getComposioServerClient(): Composio | null {
  if (composioServerClient) return composioServerClient;

  const apiKey = process.env.COMPOSIO_API_KEY;
  if (!apiKey) {
    return null;
  }

  try {
    composioServerClient = new Composio({
      apiKey,
      toolkitVersions: { GOOGLECALENDAR: "20260217_00" },
    });
    return composioServerClient;
  } catch (err) {
    console.warn("[composio] Failed to initialize Composio server client:", err);
    return null;
  }
}

/**
 * Get Composio tools for a given user.
 *
 * Uses the Supabase user ID (user.id) as Composio's user_id.
 * Each user must connect their external accounts (Gmail, GitHub, etc.)
 * via Composio's Connect Link before tools can execute.
 *
 * @param userId - Supabase auth user ID (user.id)
 * @returns LangChain-compatible tools, or empty array if Composio is not configured
 */
export async function getComposioToolsForUser(
  userId: string,
): Promise<DynamicStructuredTool[]> {
  const client = getComposioClient();
  if (!client) {
    return [];
  }

  try {
    const session = await client.create(userId);
    const tools = await session.tools();

    if (!Array.isArray(tools)) {
      return [];
    }

    return tools as unknown as DynamicStructuredTool[];
  } catch (err) {
    console.warn(
      `[composio] Failed to get tools for user ${userId.slice(0, 8)}...:`,
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

/**
 * Check if Composio is configured and available.
 */
export function isComposioEnabled(): boolean {
  return Boolean(process.env.COMPOSIO_API_KEY);
}

/** Composio toolkit slugs */
export const COMPOSIO_TOOLKIT = {
  GOOGLECALENDAR: "GOOGLECALENDAR",
  GMAIL: "GMAIL",
} as const;

/**
 * Get Composio Connect Link URL for a user to connect a toolkit.
 * User is redirected to this URL to complete OAuth.
 *
 * @param userId - Supabase user ID
 * @param toolkit - Composio toolkit slug (e.g. GOOGLECALENDAR)
 * @returns redirectUrl to send user to, or null if Composio not configured
 */
export async function getComposioConnectUrl(
  userId: string,
  toolkit: keyof typeof COMPOSIO_TOOLKIT,
): Promise<string | null> {
  const client = getComposioServerClient();
  if (!client) return null;

  try {
    const connectionRequest = await client.toolkits.authorize(
      userId,
      COMPOSIO_TOOLKIT[toolkit],
    );
    return connectionRequest.redirectUrl ?? null;
  } catch (err) {
    console.warn(
      `[composio] Failed to get connect URL for ${toolkit}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * List connected accounts for a user, optionally filtered by toolkit.
 */
export async function listComposioConnectedAccounts(
  userId: string,
  toolkit?: string,
): Promise<
  Array<{
    id: string;
    status: string;
    toolkit?: { slug?: string };
    appName?: string;
  }>
> {
  const client = getComposioServerClient();
  if (!client) return [];

  try {
    const result = await client.connectedAccounts.list({
      userIds: [userId],
      statuses: ["ACTIVE"],
      ...(toolkit && { toolkitSlugs: [toolkit] }),
    });
    return (result.items ?? []).map((item: { id: string; status: string; toolkit?: { slug?: string }; appName?: string }) => ({
      id: item.id,
      status: item.status,
      toolkit: item.toolkit,
      appName: item.appName,
    }));
  } catch (err) {
    console.warn(
      `[composio] Failed to list connected accounts for user:`,
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

/**
 * Execute GOOGLECALENDAR_EVENTS_LIST for a user's connected account.
 *
 * @param userId - Supabase user ID
 * @param connectedAccountId - Composio connected account ID
 * @param params - timeMin, timeMax, pageToken, calendarId, etc.
 */
export async function executeGoogleCalendarListEvents(
  userId: string,
  connectedAccountId: string,
  params: {
    timeMin?: string;
    timeMax?: string;
    pageToken?: string;
    calendarId?: string;
    maxResults?: number;
    singleEvents?: boolean;
  },
): Promise<{
  data?: {
    items?: Array<Record<string, unknown>>;
    nextPageToken?: string;
    nextSyncToken?: string;
  };
  error?: string;
  successful?: boolean;
}> {
  const client = getComposioServerClient();
  if (!client) {
    return { successful: false, error: "Composio not configured" };
  }

  try {
    const result = await client.tools.execute("GOOGLECALENDAR_EVENTS_LIST", {
      userId,
      connectedAccountId,
      arguments: {
        timeMin: params.timeMin,
        timeMax: params.timeMax,
        pageToken: params.pageToken,
        calendarId: params.calendarId ?? "primary",
        maxResults: params.maxResults ?? 250,
        singleEvents: params.singleEvents ?? true,
      },
    });

    const data = result.data as Record<string, unknown> | undefined;
    const error = result.error;
    const successful = result.successful ?? false;

    return {
      data: data as
        | {
            items?: Array<Record<string, unknown>>;
            nextPageToken?: string;
            nextSyncToken?: string;
          }
        | undefined,
      error: error ?? undefined,
      successful,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[composio] GOOGLECALENDAR_EVENTS_LIST failed:", message);
    return { successful: false, error: message };
  }
}

/**
 * Delete a Composio connected account.
 */
export async function deleteComposioConnectedAccount(
  connectedAccountId: string,
): Promise<boolean> {
  const client = getComposioServerClient();
  if (!client) return false;

  try {
    await client.connectedAccounts.delete(connectedAccountId);
    return true;
  } catch (err) {
    console.warn(
      `[composio] Failed to delete connected account:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}
