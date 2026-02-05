import { Client } from "@notionhq/client";
import {
  BaseAdapter,
  AdapterConfig,
  ActivityAtom,
  SyncResult,
  OAuthTokens,
  Evidence,
  FetchOptions,
  Provider,
} from "./base.adapter";

const NOTION_AUTH_URL = "https://api.notion.com/v1/oauth/authorize";
const NOTION_TOKEN_URL = "https://api.notion.com/v1/oauth/token";

export class NotionAdapter extends BaseAdapter {
  readonly provider: Provider = "notion";

  constructor(config: AdapterConfig) {
    super(config);
  }

  // ─────────────────────────────────────────────
  // OAuth Flow
  // ─────────────────────────────────────────────

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: "code",
      owner: "user",
      redirect_uri: this.config.redirectUri,
      state,
    });

    return `${NOTION_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCodeForTokens(code: string): Promise<OAuthTokens> {
    const credentials = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`,
    ).toString("base64");

    const response = await fetch(NOTION_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${credentials}`,
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: this.config.redirectUri,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Notion token exchange failed: ${error}`);
    }

    const data = await response.json();

    // Notion tokens don't expire
    return {
      accessToken: data.access_token,
      refreshToken: undefined, // Notion doesn't use refresh tokens
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
      tokenType: "Bearer",
      scope: "",
    };
  }

  async refreshAccessToken(_: string): Promise<OAuthTokens> {
    // Notion tokens are long-lived and don't require refresh
    throw new Error("Notion tokens do not require refresh");
  }

  // ─────────────────────────────────────────────
  // User Info
  // ─────────────────────────────────────────────

  async getUserInfo(
    accessToken: string,
  ): Promise<{ id: string; email?: string; name?: string }> {
    const notion = new Client({ auth: accessToken });

    // Get bot user info (limited in Notion)
    const response = await notion.users.me({});

    return {
      id: response.id,
      email: undefined, // Not available in Notion API
      name: response.name ?? undefined,
    };
  }

  // ─────────────────────────────────────────────
  // Data Fetching
  // ─────────────────────────────────────────────

  async fetchData(
    accessToken: string,
    options?: FetchOptions,
  ): Promise<SyncResult> {
    const notion = new Client({ auth: accessToken });

    // Search for all accessible pages
    const searchResponse = await notion.search({
      filter: {
        property: "object",
        value: "page",
      },
      page_size: options?.limit ?? 100,
      start_cursor: options?.cursor ?? undefined,
      sort: {
        direction: "descending",
        timestamp: "last_edited_time",
      },
    });

    const atoms = this.normalizeToAtoms(searchResponse.results as unknown[]);

    // Filter by date if specified
    let filteredAtoms = atoms;
    if (options?.since) {
      filteredAtoms = atoms.filter((atom) => atom.occurredAt >= options.since!);
    }
    if (options?.until) {
      filteredAtoms = filteredAtoms.filter(
        (atom) => atom.occurredAt <= options.until!,
      );
    }

    return {
      atoms: filteredAtoms,
      nextCursor: searchResponse.next_cursor ?? undefined,
      hasMore: searchResponse.has_more,
      syncedAt: new Date(),
    };
  }

  // ─────────────────────────────────────────────
  // Normalization
  // ─────────────────────────────────────────────

  normalizeToAtoms(pages: unknown[]): ActivityAtom[] {
    return pages
      .map((page) => this.pageToAtom(page as NotionPage))
      .filter((atom): atom is ActivityAtom => atom !== null);
  }

  private pageToAtom(page: NotionPage): ActivityAtom | null {
    if (!page.id) return null;

    // Extract title from properties
    let title = "Untitled";
    if (page.properties) {
      const titleProp = Object.values(page.properties).find(
        (prop: unknown) => (prop as { type: string }).type === "title",
      ) as { title?: Array<{ plain_text: string }> } | undefined;

      if (titleProp?.title?.[0]?.plain_text) {
        title = titleProp.title[0].plain_text;
      }
    }

    // Get last edited time
    const occurredAt = this.parseDate(page.last_edited_time) ?? new Date();

    // Build content
    const contentParts = [title, page.url ? `URL: ${page.url}` : ""];

    return {
      externalId: page.id,
      atomType: "note",
      title,
      content: this.buildSemanticContent(contentParts),
      occurredAt,
      sourceUrl: page.url ?? undefined,
      metadata: {
        objectType: page.object,
        createdTime: page.created_time,
        lastEditedTime: page.last_edited_time,
        archived: page.archived,
        parentType: page.parent?.type,
        parentId: page.parent?.page_id ?? page.parent?.database_id,
      },
    };
  }

  // ─────────────────────────────────────────────
  // Evidence Extraction
  // ─────────────────────────────────────────────

  extractEvidence(atom: ActivityAtom): Evidence {
    const snippet =
      atom.content.length > 200
        ? atom.content.substring(0, 200) + "..."
        : atom.content;

    return {
      url: atom.sourceUrl ?? "",
      title: atom.title ?? "Notion Page",
      snippet,
      provider: this.provider,
      timestamp: atom.occurredAt,
    };
  }
}

// Type definitions for Notion API responses
interface NotionPage {
  id: string;
  object: string;
  created_time?: string;
  last_edited_time?: string;
  archived?: boolean;
  url?: string;
  parent?: {
    type: string;
    page_id?: string;
    database_id?: string;
  };
  properties?: Record<string, unknown>;
}
