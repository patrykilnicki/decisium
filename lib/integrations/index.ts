export {
  encryptToken,
  decryptToken,
  isEncryptionConfigured,
  validateEncryptionSetup,
} from './crypto';

export {
  OAuthManager,
  createOAuthManager,
  type Integration,
  type IntegrationWithTokens,
  type ConnectResult,
  type AuditLogEntry,
} from './oauth-manager';

export {
  SyncPipeline,
  createSyncPipeline,
  type SyncOptions,
  type SyncProgress,
  type StoredActivityAtom,
} from './sync-pipeline';

export {
  InsightGenerator,
  createInsightGenerator,
  type InsightSource,
  type GenerateInsightOptions,
  type CalendarInsight,
} from './insight-generator';

export {
  CalendarWatchService,
  createCalendarWatchService,
  type CalendarWatch,
} from './calendar-watch.service';
