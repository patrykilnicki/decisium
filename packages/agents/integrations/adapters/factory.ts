import {
  Provider,
  AdapterConfig,
  IntegrationAdapter,
  ADAPTER_REGISTRY,
} from "./base.adapter";
import { GoogleCalendarAdapter } from "./google-calendar.adapter";
import { GmailAdapter } from "./gmail.adapter";
import { NotionAdapter } from "./notion.adapter";
import { LinearAdapter } from "./linear.adapter";

/**
 * Environment variable names for each provider
 */
const ENV_VARS: Record<Provider, { clientId: string; clientSecret: string }> = {
  google_calendar: {
    clientId: "GOOGLE_CLIENT_ID",
    clientSecret: "GOOGLE_CLIENT_SECRET",
  },
  gmail: {
    clientId: "GOOGLE_CLIENT_ID",
    clientSecret: "GOOGLE_CLIENT_SECRET",
  },
  notion: {
    clientId: "NOTION_CLIENT_ID",
    clientSecret: "NOTION_CLIENT_SECRET",
  },
  linear: {
    clientId: "LINEAR_CLIENT_ID",
    clientSecret: "LINEAR_CLIENT_SECRET",
  },
};

/**
 * Get adapter configuration from environment variables
 */
export function getAdapterConfig(
  provider: Provider,
  options?: {
    redirectUri?: string;
    useExtendedScopes?: boolean;
  },
): AdapterConfig {
  const envVars = ENV_VARS[provider];
  const registry = ADAPTER_REGISTRY[provider];

  const clientId = process.env[envVars.clientId];
  const clientSecret = process.env[envVars.clientSecret];

  if (!clientId || !clientSecret) {
    throw new Error(
      `Missing environment variables for ${provider}: ` +
        `${envVars.clientId} and ${envVars.clientSecret} are required`,
    );
  }

  // Determine redirect URI
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const redirectUri =
    options?.redirectUri ?? `${baseUrl}/api/integrations/${provider}/callback`;

  // Select scopes
  const scopes = options?.useExtendedScopes
    ? [...registry.scopes.minimal, ...registry.scopes.extended]
    : registry.scopes.minimal;

  return {
    provider,
    clientId,
    clientSecret,
    redirectUri,
    scopes,
  };
}

/**
 * Create an adapter instance for the given provider
 */
export function createAdapter(
  provider: Provider,
  config?: AdapterConfig,
): IntegrationAdapter {
  const adapterConfig = config ?? getAdapterConfig(provider);

  switch (provider) {
    case "google_calendar":
      return new GoogleCalendarAdapter(adapterConfig);
    case "gmail":
      return new GmailAdapter(adapterConfig);
    case "notion":
      return new NotionAdapter(adapterConfig);
    case "linear":
      return new LinearAdapter(adapterConfig);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Create adapters for all configured providers
 */
export function createConfiguredAdapters(): Map<Provider, IntegrationAdapter> {
  const adapters = new Map<Provider, IntegrationAdapter>();

  for (const provider of Object.keys(ADAPTER_REGISTRY) as Provider[]) {
    try {
      const config = getAdapterConfig(provider);
      adapters.set(provider, createAdapter(provider, config));
    } catch {
      // Provider not configured, skip
    }
  }

  return adapters;
}

/**
 * Check if a provider is configured (has required env vars)
 */
export function isProviderConfigured(provider: Provider): boolean {
  const envVars = ENV_VARS[provider];
  return !!(process.env[envVars.clientId] && process.env[envVars.clientSecret]);
}

/**
 * Get list of configured providers
 */
export function getConfiguredProviders(): Provider[] {
  return (Object.keys(ADAPTER_REGISTRY) as Provider[]).filter(
    isProviderConfigured,
  );
}
