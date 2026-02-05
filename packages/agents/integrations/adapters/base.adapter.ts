import { z } from "zod";

// ============================================
// Provider Types
// ============================================

export const PROVIDERS = [
  "google_calendar",
  "gmail",
  "notion",
  "linear",
] as const;

export type Provider = (typeof PROVIDERS)[number];

export const ProviderSchema = z.enum(PROVIDERS);

// ============================================
// Adapter Configuration
// ============================================

export const AdapterConfigSchema = z.object({
  provider: ProviderSchema,
  clientId: z.string(),
  clientSecret: z.string(),
  redirectUri: z.string(),
  scopes: z.array(z.string()),
});

export type AdapterConfig = z.infer<typeof AdapterConfigSchema>;

// ============================================
// Activity Atom Types
// ============================================

export const ATOM_TYPES = [
  "event",
  "message",
  "task",
  "note",
  "comment",
] as const;

export type AtomType = (typeof ATOM_TYPES)[number];

export const AtomTypeSchema = z.enum(ATOM_TYPES);

// ============================================
// Activity Atom Schema
// ============================================

export const ActivityAtomSchema = z.object({
  externalId: z.string(),
  atomType: AtomTypeSchema,
  title: z.string().optional(),
  content: z.string(),
  occurredAt: z.date(),
  durationMinutes: z.number().optional(),
  participants: z.array(z.string()).optional(),
  sourceUrl: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type ActivityAtom = z.infer<typeof ActivityAtomSchema>;

// ============================================
// OAuth Tokens
// ============================================

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  tokenType: string;
  scope: string;
}

export const OAuthTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresAt: z.date(),
  tokenType: z.string(),
  scope: z.string(),
});

// ============================================
// Sync Result
// ============================================

export interface SyncResult {
  atoms: ActivityAtom[];
  nextCursor?: string;
  /** Google Calendar: nextSyncToken for incremental sync */
  nextSyncToken?: string;
  /** Google Calendar: external IDs of deleted/cancelled events to remove from DB */
  deletedExternalIds?: string[];
  hasMore: boolean;
  syncedAt: Date;
}

// ============================================
// Evidence
// ============================================

export interface Evidence {
  url: string;
  title: string;
  snippet: string;
  provider: Provider;
  timestamp: Date;
}

// ============================================
// Fetch Options
// ============================================

export interface FetchOptions {
  cursor?: string;
  /** Google Calendar: syncToken for incremental sync (only new/changed events) */
  syncToken?: string;
  /** Google Calendar: calendar ID (default 'primary') */
  calendarId?: string;
  since?: Date;
  until?: Date;
  limit?: number;
}

// ============================================
// Integration Adapter Interface
// ============================================

export interface IntegrationAdapter {
  /**
   * Provider identifier
   */
  readonly provider: Provider;

  /**
   * Adapter configuration
   */
  readonly config: AdapterConfig;

  // ─────────────────────────────────────────────
  // OAuth Flow
  // ─────────────────────────────────────────────

  /**
   * Generate OAuth authorization URL
   * @param state - CSRF protection state parameter
   * @returns Authorization URL to redirect user to
   */
  getAuthorizationUrl(state: string): string;

  /**
   * Exchange authorization code for tokens
   * @param code - Authorization code from OAuth callback
   * @returns OAuth tokens
   */
  exchangeCodeForTokens(code: string): Promise<OAuthTokens>;

  /**
   * Refresh access token using refresh token
   * @param refreshToken - Refresh token
   * @returns New OAuth tokens
   */
  refreshAccessToken(refreshToken: string): Promise<OAuthTokens>;

  /**
   * Revoke OAuth tokens (disconnect)
   * @param accessToken - Access token to revoke
   */
  revokeTokens?(accessToken: string): Promise<void>;

  // ─────────────────────────────────────────────
  // Data Fetching
  // ─────────────────────────────────────────────

  /**
   * Fetch data from the provider
   * @param accessToken - Valid access token
   * @param options - Fetch options (cursor, date range, limit)
   * @returns Sync result with activity atoms
   */
  fetchData(accessToken: string, options?: FetchOptions): Promise<SyncResult>;

  // ─────────────────────────────────────────────
  // Normalization
  // ─────────────────────────────────────────────

  /**
   * Transform raw provider data to activity atoms
   * @param rawData - Raw data from provider API
   * @returns Normalized activity atoms
   */
  normalizeToAtoms(rawData: unknown[]): ActivityAtom[];

  // ─────────────────────────────────────────────
  // Evidence Extraction
  // ─────────────────────────────────────────────

  /**
   * Extract evidence from an activity atom
   * @param atom - Activity atom
   * @returns Evidence with URL, title, snippet
   */
  extractEvidence(atom: ActivityAtom): Evidence;

  // ─────────────────────────────────────────────
  // User Info (Optional)
  // ─────────────────────────────────────────────

  /**
   * Get user info from provider (email, name, etc.)
   * @param accessToken - Valid access token
   * @returns User info object
   */
  getUserInfo?(accessToken: string): Promise<{
    id: string;
    email?: string;
    name?: string;
  }>;
}

// ============================================
// Base Adapter Class
// ============================================

export abstract class BaseAdapter implements IntegrationAdapter {
  abstract readonly provider: Provider;
  readonly config: AdapterConfig;

  constructor(config: AdapterConfig) {
    this.config = config;
  }

  abstract getAuthorizationUrl(state: string): string;
  abstract exchangeCodeForTokens(code: string): Promise<OAuthTokens>;
  abstract refreshAccessToken(refreshToken: string): Promise<OAuthTokens>;
  abstract fetchData(
    accessToken: string,
    options?: FetchOptions,
  ): Promise<SyncResult>;
  abstract normalizeToAtoms(rawData: unknown[]): ActivityAtom[];
  abstract extractEvidence(atom: ActivityAtom): Evidence;

  /**
   * Check if token is expired or will expire soon
   */
  protected isTokenExpired(expiresAt: Date, bufferMinutes = 5): boolean {
    const bufferMs = bufferMinutes * 60 * 1000;
    return Date.now() >= expiresAt.getTime() - bufferMs;
  }

  /**
   * Truncate content to a maximum length
   */
  protected truncateContent(content: string, maxLength = 2000): string {
    if (content.length <= maxLength) {
      return content;
    }
    return content.substring(0, maxLength - 3) + "...";
  }

  /**
   * Build semantic content string from parts
   */
  protected buildSemanticContent(parts: (string | undefined | null)[]): string {
    return parts.filter(Boolean).join("\n");
  }

  /**
   * Parse ISO date string safely
   */
  protected parseDate(dateString: string | undefined | null): Date | undefined {
    if (!dateString) return undefined;
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? undefined : date;
  }
}

// ============================================
// Adapter Registry Types
// ============================================

export interface AdapterRegistryEntry {
  provider: Provider;
  displayName: string;
  description: string;
  iconUrl?: string;
  scopes: {
    minimal: string[];
    extended: string[];
  };
  capabilities: {
    read: boolean;
    write: boolean;
    webhooks: boolean;
    realtime: boolean;
  };
}

export const ADAPTER_REGISTRY: Record<Provider, AdapterRegistryEntry> = {
  google_calendar: {
    provider: "google_calendar",
    displayName: "Google Calendar",
    description: "Sync calendar events and meeting schedules",
    scopes: {
      minimal: ["https://www.googleapis.com/auth/calendar.readonly"],
      extended: ["https://www.googleapis.com/auth/calendar.events"],
    },
    capabilities: {
      read: true,
      write: true,
      webhooks: true,
      realtime: true,
    },
  },
  gmail: {
    provider: "gmail",
    displayName: "Gmail",
    description: "Sync emails and communication history",
    scopes: {
      minimal: ["https://www.googleapis.com/auth/gmail.readonly"],
      extended: ["https://www.googleapis.com/auth/gmail.compose"],
    },
    capabilities: {
      read: true,
      write: true,
      webhooks: false,
      realtime: false,
    },
  },
  notion: {
    provider: "notion",
    displayName: "Notion",
    description: "Sync pages, databases, and notes",
    scopes: {
      minimal: [],
      extended: [],
    },
    capabilities: {
      read: true,
      write: true,
      webhooks: false,
      realtime: false,
    },
  },
  linear: {
    provider: "linear",
    displayName: "Linear",
    description: "Sync issues, projects, and tasks",
    scopes: {
      minimal: ["read"],
      extended: ["read", "write"],
    },
    capabilities: {
      read: true,
      write: true,
      webhooks: true,
      realtime: true,
    },
  },
};
