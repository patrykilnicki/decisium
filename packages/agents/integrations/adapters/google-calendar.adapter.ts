import { google, calendar_v3 } from 'googleapis';
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

export class GoogleCalendarAdapter extends BaseAdapter {
  readonly provider: Provider = 'google_calendar';
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
      prompt: 'consent', // Force refresh token
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

    const oauth2 = google.oauth2({ version: 'v2', auth: this.oauth2Client });
    const { data } = await oauth2.userinfo.get();

    return {
      id: data.id ?? '',
      email: data.email ?? undefined,
      name: data.name ?? undefined,
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

    const calendar = google.calendar({
      version: 'v3',
      auth: this.oauth2Client,
    });

    const calendarId = options?.calendarId ?? 'primary';

    if (options?.syncToken) {
      return this.fetchDataIncremental(calendar, calendarId, options);
    }

    // Full sync: time range + orderBy, follow all pages
    // Note: Google Calendar API doesn't always return nextSyncToken when using timeMin/timeMax
    // So we make a final call without filters to get the syncToken for incremental sync
    const now = new Date();
    const timeMin = options?.since ?? new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const timeMax = options?.until ?? new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

    const allAtoms: ActivityAtom[] = [];
    let pageToken: string | undefined = options?.cursor;
    let nextSyncToken: string | undefined;

    // Fetch all pages with time filters
    do {
      const response = await calendar.events.list({
        calendarId,
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: options?.limit ?? 250,
        pageToken,
      });

      const items = response.data.items ?? [];
      allAtoms.push(...this.normalizeToAtoms(items));

      pageToken = response.data.nextPageToken ?? undefined;
      // nextSyncToken is only available on the last page (when nextPageToken is undefined)
      if (!pageToken && response.data.nextSyncToken) {
        nextSyncToken = response.data.nextSyncToken;
      }
    } while (pageToken);

    // If we didn't get a syncToken (common when using timeMin/timeMax), paginate without filters
    // nextSyncToken is only returned on the last page, so we must follow pages until we get it
    if (!nextSyncToken) {
      try {
        let syncPageToken: string | undefined;
        do {
          const syncTokenResponse = await calendar.events.list({
            calendarId,
            singleEvents: true,
            maxResults: 250,
            pageToken: syncPageToken,
          });
          syncPageToken = syncTokenResponse.data.nextPageToken ?? undefined;
          if (!syncPageToken && syncTokenResponse.data.nextSyncToken) {
            nextSyncToken = syncTokenResponse.data.nextSyncToken;
          }
        } while (syncPageToken);
      } catch (error) {
        console.warn('[google-calendar-adapter] Failed to get syncToken after full sync:', error);
        // Continue without syncToken - will do full sync next time
      }
    }

    return {
      atoms: allAtoms,
      nextCursor: undefined,
      nextSyncToken,
      hasMore: false,
      syncedAt: new Date(),
    };
  }

  /**
   * Incremental sync using syncToken – only new/changed events.
   * Cannot use timeMin, timeMax, orderBy with syncToken.
   */
  private async fetchDataIncremental(
    calendar: calendar_v3.Calendar,
    calendarId: string,
    options: FetchOptions
  ): Promise<SyncResult> {
    const atoms: ActivityAtom[] = [];
    const deletedExternalIds: string[] = [];
    let pageToken: string | undefined = options.cursor;
    let nextSyncToken: string | undefined;
    const syncToken = options.syncToken!;

    do {
      const response = await calendar.events.list({
        calendarId,
        syncToken,
        singleEvents: true,
        maxResults: options?.limit ?? 250,
        pageToken,
      });

      const items = response.data.items ?? [];

      for (const event of items) {
        if (event.status === 'cancelled' && event.id) {
          deletedExternalIds.push(event.id);
        } else if (event.id && (event.start?.dateTime || event.start?.date)) {
          atoms.push(this.eventToAtom(event));
        }
      }

      pageToken = response.data.nextPageToken ?? undefined;
      nextSyncToken = response.data.nextSyncToken ?? undefined;
    } while (pageToken);

    return {
      atoms,
      nextSyncToken,
      deletedExternalIds: deletedExternalIds.length > 0 ? deletedExternalIds : undefined,
      hasMore: false,
      syncedAt: new Date(),
    };
  }

  // ─────────────────────────────────────────────
  // Watch (Push Notifications)
  // ─────────────────────────────────────────────

  /**
   * Set up push notifications for calendar events.
   * Google will POST to webhookUrl when events change.
   */
  async setupWatch(
    accessToken: string,
    webhookUrl: string,
    options?: { calendarId?: string; channelToken?: string; ttlSeconds?: number }
  ): Promise<{
    channelId: string;
    resourceId: string;
    resourceUri?: string;
    expiration: number;
  }> {
    this.oauth2Client.setCredentials({ access_token: accessToken });

    const calendar = google.calendar({
      version: 'v3',
      auth: this.oauth2Client,
    });

    const channelId = crypto.randomUUID();
    const calendarId = options?.calendarId ?? 'primary';
    const ttlSeconds = options?.ttlSeconds ?? 604800; // 7 days default
    const expiration = Date.now() + ttlSeconds * 1000;

    const response = await calendar.events.watch({
      calendarId,
      requestBody: {
        id: channelId,
        type: 'web_hook',
        address: webhookUrl,
        token: options?.channelToken,
        expiration: String(expiration),
      },
    });

    return {
      channelId: response.data.id ?? channelId,
      resourceId: response.data.resourceId ?? '',
      resourceUri: response.data.resourceUri ?? undefined,
      expiration: Number(response.data.expiration ?? expiration),
    };
  }

  /**
   * Stop push notifications for a channel.
   */
  async stopWatch(
    accessToken: string,
    channelId: string,
    resourceId: string
  ): Promise<void> {
    this.oauth2Client.setCredentials({ access_token: accessToken });

    const calendar = google.calendar({
      version: 'v3',
      auth: this.oauth2Client,
    });

    await calendar.channels.stop({
      requestBody: {
        id: channelId,
        resourceId,
      },
    });
  }

  /**
   * Fetch all calendars for the user
   */
  async fetchCalendars(
    accessToken: string
  ): Promise<{ id: string; name: string; primary: boolean }[]> {
    this.oauth2Client.setCredentials({ access_token: accessToken });

    const calendar = google.calendar({
      version: 'v3',
      auth: this.oauth2Client,
    });

    const response = await calendar.calendarList.list();
    const items = response.data.items ?? [];

    return items.map((cal) => ({
      id: cal.id ?? '',
      name: cal.summary ?? 'Untitled Calendar',
      primary: cal.primary ?? false,
    }));
  }

  // ─────────────────────────────────────────────
  // Normalization
  // ─────────────────────────────────────────────

  normalizeToAtoms(events: calendar_v3.Schema$Event[]): ActivityAtom[] {
    return events
      .filter((event) => event.id && (event.start?.dateTime || event.start?.date))
      .map((event) => this.eventToAtom(event));
  }

  private eventToAtom(event: calendar_v3.Schema$Event): ActivityAtom {
    const startTime = event.start?.dateTime ?? event.start?.date;
    const endTime = event.end?.dateTime ?? event.end?.date;

    // Calculate duration in minutes
    let durationMinutes: number | undefined;
    if (startTime && endTime) {
      const start = new Date(startTime);
      const end = new Date(endTime);
      durationMinutes = Math.round(
        (end.getTime() - start.getTime()) / (1000 * 60)
      );

      // All-day events: duration is in days * 24 * 60
      // Cap duration at 24 hours for display purposes
      if (durationMinutes > 24 * 60) {
        durationMinutes = undefined; // All-day event
      }
    }

    // Extract participant emails/names
    const participants = (event.attendees ?? [])
      .map((a) => a.displayName ?? a.email ?? '')
      .filter(Boolean);

    // Determine if it's a meeting (has attendees or conference)
    const isMeeting =
      participants.length > 0 || !!event.conferenceData?.entryPoints?.length;

    // Build semantic content for AI
    const contentParts = [
      event.summary ?? 'Untitled Event',
      event.description ? `Description: ${this.truncateContent(event.description, 500)}` : '',
      participants.length > 0 ? `Participants: ${participants.join(', ')}` : '',
      event.location ? `Location: ${event.location}` : '',
      event.conferenceData?.entryPoints?.[0]?.uri
        ? `Meeting link: ${event.conferenceData.entryPoints[0].uri}`
        : '',
    ];

    return {
      externalId: event.id!,
      atomType: 'event',
      title: event.summary ?? 'Untitled Event',
      content: this.buildSemanticContent(contentParts),
      occurredAt: new Date(startTime!),
      durationMinutes,
      participants: participants.length > 0 ? participants : undefined,
      sourceUrl: event.htmlLink ?? undefined,
      metadata: {
        status: event.status,
        recurrence: event.recurrence,
        location: event.location,
        conferenceUri: event.conferenceData?.entryPoints?.[0]?.uri,
        organizer: event.organizer?.email,
        organizerName: event.organizer?.displayName,
        isAllDay: !event.start?.dateTime,
        isMeeting,
        eventType: event.eventType,
        visibility: event.visibility,
        calendarId: 'primary',
        originalStartTime: event.originalStartTime?.dateTime,
        recurringEventId: event.recurringEventId,
      },
    };
  }

  // ─────────────────────────────────────────────
  // Evidence Extraction
  // ─────────────────────────────────────────────

  extractEvidence(atom: ActivityAtom): Evidence {
    // Create a snippet from the content
    const snippet = atom.content.length > 200
      ? atom.content.substring(0, 200) + '...'
      : atom.content;

    return {
      url: atom.sourceUrl ?? '',
      title: atom.title ?? 'Calendar Event',
      snippet,
      provider: this.provider,
      timestamp: atom.occurredAt,
    };
  }
}
