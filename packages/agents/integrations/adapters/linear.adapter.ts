import { LinearClient, Issue } from '@linear/sdk';
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

const LINEAR_AUTH_URL = 'https://linear.app/oauth/authorize';
const LINEAR_TOKEN_URL = 'https://api.linear.app/oauth/token';
const LINEAR_REVOKE_URL = 'https://api.linear.app/oauth/revoke';

export class LinearAdapter extends BaseAdapter {
  readonly provider: Provider = 'linear';

  constructor(config: AdapterConfig) {
    super(config);
  }

  // ─────────────────────────────────────────────
  // OAuth Flow
  // ─────────────────────────────────────────────

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: 'code',
      redirect_uri: this.config.redirectUri,
      state,
      scope: this.config.scopes.join(','),
      prompt: 'consent',
    });

    return `${LINEAR_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCodeForTokens(code: string): Promise<OAuthTokens> {
    const response = await fetch(LINEAR_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.config.redirectUri,
        code,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Linear token exchange failed: ${error}`);
    }

    const data = await response.json();

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? undefined,
      expiresAt: new Date(Date.now() + (data.expires_in ?? 315360000) * 1000), // ~10 years default
      tokenType: data.token_type ?? 'Bearer',
      scope: data.scope ?? '',
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
    const response = await fetch(LINEAR_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Linear token refresh failed: ${error}`);
    }

    const data = await response.json();

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: new Date(Date.now() + (data.expires_in ?? 315360000) * 1000),
      tokenType: data.token_type ?? 'Bearer',
      scope: data.scope ?? '',
    };
  }

  async revokeTokens(accessToken: string): Promise<void> {
    await fetch(LINEAR_REVOKE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Bearer ${accessToken}`,
      },
    });
  }

  // ─────────────────────────────────────────────
  // User Info
  // ─────────────────────────────────────────────

  async getUserInfo(
    accessToken: string
  ): Promise<{ id: string; email?: string; name?: string }> {
    const client = new LinearClient({ accessToken });
    const viewer = await client.viewer;

    return {
      id: viewer.id,
      email: viewer.email ?? undefined,
      name: viewer.name ?? undefined,
    };
  }

  // ─────────────────────────────────────────────
  // Data Fetching
  // ─────────────────────────────────────────────

  async fetchData(
    accessToken: string,
    options?: FetchOptions
  ): Promise<SyncResult> {
    const client = new LinearClient({ accessToken });

    // Build filter
    const filter: Record<string, unknown> = {};

    if (options?.since) {
      filter.updatedAt = { gte: options.since.toISOString() };
    }

    if (options?.until) {
      filter.updatedAt = {
        ...(filter.updatedAt as object || {}),
        lte: options.until.toISOString(),
      };
    }

    // Fetch issues assigned to or created by user
    const issues = await client.issues({
      first: options?.limit ?? 50,
      after: options?.cursor ?? undefined,
      filter: Object.keys(filter).length > 0 ? filter : undefined,
    });

    const issueNodes = issues.nodes;
    const atoms = await this.normalizeIssues(issueNodes);

    return {
      atoms,
      nextCursor: issues.pageInfo.hasNextPage
        ? issues.pageInfo.endCursor ?? undefined
        : undefined,
      hasMore: issues.pageInfo.hasNextPage,
      syncedAt: new Date(),
    };
  }

  // ─────────────────────────────────────────────
  // Normalization
  // ─────────────────────────────────────────────

  normalizeToAtoms(issues: unknown[]): ActivityAtom[] {
    // This is a sync version - for Linear we need async due to nested data
    return (issues as Issue[])
      .map((issue) => this.issueToAtomSync(issue))
      .filter((atom): atom is ActivityAtom => atom !== null);
  }

  private async normalizeIssues(issues: Issue[]): Promise<ActivityAtom[]> {
    const atoms: ActivityAtom[] = [];

    for (const issue of issues) {
      const atom = await this.issueToAtom(issue);
      if (atom) {
        atoms.push(atom);
      }
    }

    return atoms;
  }

  private async issueToAtom(issue: Issue): Promise<ActivityAtom | null> {
    if (!issue.id) return null;

    // Fetch related data
    const [state, assignee, project] = await Promise.all([
      issue.state,
      issue.assignee,
      issue.project,
    ]);

    const title = issue.title ?? 'Untitled Issue';
    const occurredAt = new Date(issue.updatedAt);

    // Build content
    const contentParts = [
      `[${issue.identifier}] ${title}`,
      issue.description
        ? `Description: ${this.truncateContent(issue.description, 500)}`
        : '',
      state?.name ? `Status: ${state.name}` : '',
      assignee?.name ? `Assignee: ${assignee.name}` : '',
      project?.name ? `Project: ${project.name}` : '',
      issue.priority ? `Priority: ${this.getPriorityLabel(issue.priority)}` : '',
    ];

    // Participants (assignee)
    const participants: string[] = [];
    if (assignee?.name) {
      participants.push(assignee.name);
    }

    return {
      externalId: issue.id,
      atomType: 'task',
      title: `[${issue.identifier}] ${title}`,
      content: this.buildSemanticContent(contentParts),
      occurredAt,
      participants: participants.length > 0 ? participants : undefined,
      sourceUrl: issue.url ?? undefined,
      metadata: {
        identifier: issue.identifier,
        state: state?.name,
        stateType: state?.type,
        priority: issue.priority,
        priorityLabel: this.getPriorityLabel(issue.priority),
        assigneeId: assignee?.id,
        assigneeName: assignee?.name,
        projectId: project?.id,
        projectName: project?.name,
        createdAt: issue.createdAt,
        completedAt: issue.completedAt,
        canceledAt: issue.canceledAt,
        estimate: issue.estimate,
      },
    };
  }

  private issueToAtomSync(issue: Issue): ActivityAtom | null {
    if (!issue.id) return null;

    const title = issue.title ?? 'Untitled Issue';
    const occurredAt = new Date(issue.updatedAt);

    const contentParts = [
      `[${issue.identifier}] ${title}`,
      issue.description
        ? `Description: ${this.truncateContent(issue.description, 500)}`
        : '',
      issue.priority ? `Priority: ${this.getPriorityLabel(issue.priority)}` : '',
    ];

    return {
      externalId: issue.id,
      atomType: 'task',
      title: `[${issue.identifier}] ${title}`,
      content: this.buildSemanticContent(contentParts),
      occurredAt,
      sourceUrl: issue.url ?? undefined,
      metadata: {
        identifier: issue.identifier,
        priority: issue.priority,
        priorityLabel: this.getPriorityLabel(issue.priority),
        createdAt: issue.createdAt,
        completedAt: issue.completedAt,
      },
    };
  }

  private getPriorityLabel(priority: number | undefined): string {
    switch (priority) {
      case 0:
        return 'No priority';
      case 1:
        return 'Urgent';
      case 2:
        return 'High';
      case 3:
        return 'Medium';
      case 4:
        return 'Low';
      default:
        return 'Unknown';
    }
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
      title: atom.title ?? 'Linear Issue',
      snippet,
      provider: this.provider,
      timestamp: atom.occurredAt,
    };
  }
}
