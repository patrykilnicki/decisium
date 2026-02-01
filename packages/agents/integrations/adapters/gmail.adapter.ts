import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import {
  BaseAdapter,
  AdapterConfig,
  ActivityAtom,
  SyncResult,
  OAuthTokens,
  Evidence,
  FetchOptions,
  Provider,
} from './base.adapter';

export class GmailAdapter extends BaseAdapter {
  readonly provider: Provider = 'gmail';
  private oauth2Client: OAuth2Client;

  constructor(config: AdapterConfig) {
    super(config);
    this.oauth2Client = new google.auth.OAuth2(
      config.clientId,
      config.clientSecret,
      config.redirectUri
    );
  }

  // ─────────────────────────────────────────────
  // OAuth Flow
  // ─────────────────────────────────────────────

  getAuthorizationUrl(state: string): string {
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: this.config.scopes,
      state,
      prompt: 'consent',
      include_granted_scopes: true,
    });
  }

  async exchangeCodeForTokens(code: string): Promise<OAuthTokens> {
    const { tokens } = await this.oauth2Client.getToken(code);

    if (!tokens.access_token) {
      throw new Error('No access token received from Google');
    }

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? undefined,
      expiresAt: new Date(tokens.expiry_date ?? Date.now() + 3600 * 1000),
      tokenType: tokens.token_type ?? 'Bearer',
      scope: tokens.scope ?? '',
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
    this.oauth2Client.setCredentials({ refresh_token: refreshToken });

    const { credentials } = await this.oauth2Client.refreshAccessToken();

    if (!credentials.access_token) {
      throw new Error('Failed to refresh access token');
    }

    return {
      accessToken: credentials.access_token,
      refreshToken: credentials.refresh_token ?? refreshToken,
      expiresAt: new Date(credentials.expiry_date ?? Date.now() + 3600 * 1000),
      tokenType: credentials.token_type ?? 'Bearer',
      scope: credentials.scope ?? '',
    };
  }

  async revokeTokens(accessToken: string): Promise<void> {
    await this.oauth2Client.revokeToken(accessToken);
  }

  // ─────────────────────────────────────────────
  // User Info
  // ─────────────────────────────────────────────

  async getUserInfo(
    accessToken: string
  ): Promise<{ id: string; email?: string; name?: string }> {
    this.oauth2Client.setCredentials({ access_token: accessToken });

    const gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
    const { data } = await gmail.users.getProfile({ userId: 'me' });

    return {
      id: data.historyId ?? '',
      email: data.emailAddress ?? undefined,
      name: undefined,
    };
  }

  // ─────────────────────────────────────────────
  // Data Fetching
  // ─────────────────────────────────────────────

  async fetchData(
    accessToken: string,
    options?: FetchOptions
  ): Promise<SyncResult> {
    this.oauth2Client.setCredentials({ access_token: accessToken });

    const gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });

    // Build query for messages
    const queryParts: string[] = [];

    if (options?.since) {
      const afterDate = Math.floor(options.since.getTime() / 1000);
      queryParts.push(`after:${afterDate}`);
    }

    if (options?.until) {
      const beforeDate = Math.floor(options.until.getTime() / 1000);
      queryParts.push(`before:${beforeDate}`);
    }

    // Fetch message list
    const listResponse = await gmail.users.messages.list({
      userId: 'me',
      maxResults: options?.limit ?? 50,
      pageToken: options?.cursor ?? undefined,
      q: queryParts.join(' ') || undefined,
    });

    const messageIds = listResponse.data.messages ?? [];

    // Fetch full message details in batches
    const atoms: ActivityAtom[] = [];

    for (const msg of messageIds) {
      if (!msg.id) continue;

      try {
        const messageResponse = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'metadata',
          metadataHeaders: ['From', 'To', 'Subject', 'Date'],
        });

        const atom = this.messageToAtom(messageResponse.data);
        if (atom) {
          atoms.push(atom);
        }
      } catch (error) {
        // Skip messages that can't be fetched
        console.warn(`Failed to fetch message ${msg.id}:`, error);
      }
    }

    return {
      atoms,
      nextCursor: listResponse.data.nextPageToken ?? undefined,
      hasMore: !!listResponse.data.nextPageToken,
      syncedAt: new Date(),
    };
  }

  // ─────────────────────────────────────────────
  // Normalization
  // ─────────────────────────────────────────────

  normalizeToAtoms(messages: gmail_v1.Schema$Message[]): ActivityAtom[] {
    return messages
      .map((msg) => this.messageToAtom(msg))
      .filter((atom): atom is ActivityAtom => atom !== null);
  }

  private messageToAtom(message: gmail_v1.Schema$Message): ActivityAtom | null {
    if (!message.id) return null;

    const headers = message.payload?.headers ?? [];
    const getHeader = (name: string): string | undefined =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? undefined;

    const subject = getHeader('Subject') ?? 'No Subject';
    const from = getHeader('From') ?? '';
    const to = getHeader('To') ?? '';
    const dateStr = getHeader('Date');

    // Parse date
    let occurredAt: Date;
    if (dateStr) {
      occurredAt = new Date(dateStr);
      if (isNaN(occurredAt.getTime())) {
        occurredAt = new Date(parseInt(message.internalDate ?? '0', 10));
      }
    } else if (message.internalDate) {
      occurredAt = new Date(parseInt(message.internalDate, 10));
    } else {
      return null;
    }

    // Extract participants
    const participants: string[] = [];
    if (from) participants.push(from);
    if (to) {
      to.split(',').forEach((email) => {
        const trimmed = email.trim();
        if (trimmed && !participants.includes(trimmed)) {
          participants.push(trimmed);
        }
      });
    }

    // Get snippet for content
    const snippet = message.snippet ?? '';

    // Build semantic content
    const contentParts = [
      `Subject: ${subject}`,
      `From: ${from}`,
      to ? `To: ${to}` : '',
      snippet ? `Preview: ${snippet}` : '',
    ];

    // Gmail deep link
    const sourceUrl = `https://mail.google.com/mail/u/0/#inbox/${message.id}`;

    return {
      externalId: message.id,
      atomType: 'message',
      title: subject,
      content: this.buildSemanticContent(contentParts),
      occurredAt,
      participants: participants.length > 0 ? participants : undefined,
      sourceUrl,
      metadata: {
        threadId: message.threadId,
        labelIds: message.labelIds,
        snippet,
        sizeEstimate: message.sizeEstimate,
      },
    };
  }

  // ─────────────────────────────────────────────
  // Evidence Extraction
  // ─────────────────────────────────────────────

  extractEvidence(atom: ActivityAtom): Evidence {
    const snippet = atom.content.length > 200
      ? atom.content.substring(0, 200) + '...'
      : atom.content;

    return {
      url: atom.sourceUrl ?? '',
      title: atom.title ?? 'Email',
      snippet,
      provider: this.provider,
      timestamp: atom.occurredAt,
    };
  }
}
