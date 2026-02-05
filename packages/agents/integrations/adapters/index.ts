// Base types and interfaces
export {
  // Provider types
  PROVIDERS,
  ProviderSchema,

  // Adapter config
  AdapterConfigSchema,

  // Atom types
  ATOM_TYPES,
  AtomTypeSchema,
  ActivityAtomSchema,

  // OAuth
  OAuthTokensSchema,

  // Base class
  BaseAdapter,

  // Registry
  ADAPTER_REGISTRY,
} from "./base.adapter";

// Type exports
export type {
  Provider,
  AdapterConfig,
  AtomType,
  ActivityAtom,
  OAuthTokens,
  SyncResult,
  FetchOptions,
  Evidence,
  IntegrationAdapter,
  AdapterRegistryEntry,
} from "./base.adapter";

// Adapter implementations
export { GoogleCalendarAdapter } from "./google-calendar.adapter";
export { GmailAdapter } from "./gmail.adapter";
export { NotionAdapter } from "./notion.adapter";
export { LinearAdapter } from "./linear.adapter";

// Adapter factory
export { createAdapter, getAdapterConfig } from "./factory";
