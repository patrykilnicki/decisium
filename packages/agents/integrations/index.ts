// Adapters
export * from './adapters';

// Types re-exported for convenience
export type {
  Provider,
  AdapterConfig,
  ActivityAtom,
  AtomType,
  OAuthTokens,
  SyncResult,
  FetchOptions,
  Evidence,
  IntegrationAdapter,
  AdapterRegistryEntry,
} from './adapters';

export {
  PROVIDERS,
  ATOM_TYPES,
  ADAPTER_REGISTRY,
  ProviderSchema,
  AtomTypeSchema,
  ActivityAtomSchema,
  AdapterConfigSchema,
  OAuthTokensSchema,
  BaseAdapter,
} from './adapters';
