import type { Database } from "./supabase";

// ============================================================================
// Table Row Types
// ============================================================================

export type ActivityAtom =
  Database["public"]["Tables"]["activity_atoms"]["Row"];
export type AskMessage = Database["public"]["Tables"]["ask_messages"]["Row"];
export type AskThread = Database["public"]["Tables"]["ask_threads"]["Row"];
export type CalendarWatch =
  Database["public"]["Tables"]["calendar_watches"]["Row"];
export type DailyEvent = Database["public"]["Tables"]["daily_events"]["Row"];
export type DailySummary =
  Database["public"]["Tables"]["daily_summaries"]["Row"];
export type Embedding = Database["public"]["Tables"]["embeddings"]["Row"];
export type InsightSource =
  Database["public"]["Tables"]["insight_sources"]["Row"];
export type IntegrationAuditLog =
  Database["public"]["Tables"]["integration_audit_logs"]["Row"];
export type IntegrationCredential =
  Database["public"]["Tables"]["integration_credentials"]["Row"];
export type Integration = Database["public"]["Tables"]["integrations"]["Row"];
export type MonthlySummary =
  Database["public"]["Tables"]["monthly_summaries"]["Row"];
export type PendingCalendarSync =
  Database["public"]["Tables"]["pending_calendar_syncs"]["Row"];
export type Task = Database["public"]["Tables"]["tasks"]["Row"];
export type TaskEvent = Database["public"]["Tables"]["task_events"]["Row"];
export type UserSignal = Database["public"]["Tables"]["user_signals"]["Row"];
export type User = Database["public"]["Tables"]["users"]["Row"];
export type WeeklySummary =
  Database["public"]["Tables"]["weekly_summaries"]["Row"];

// ============================================================================
// Table Insert Types
// ============================================================================

export type ActivityAtomInsert =
  Database["public"]["Tables"]["activity_atoms"]["Insert"];
export type AskMessageInsert =
  Database["public"]["Tables"]["ask_messages"]["Insert"];
export type AskThreadInsert =
  Database["public"]["Tables"]["ask_threads"]["Insert"];
export type CalendarWatchInsert =
  Database["public"]["Tables"]["calendar_watches"]["Insert"];
export type DailyEventInsert =
  Database["public"]["Tables"]["daily_events"]["Insert"];
export type DailySummaryInsert =
  Database["public"]["Tables"]["daily_summaries"]["Insert"];
export type EmbeddingInsert =
  Database["public"]["Tables"]["embeddings"]["Insert"];
export type InsightSourceInsert =
  Database["public"]["Tables"]["insight_sources"]["Insert"];
export type IntegrationAuditLogInsert =
  Database["public"]["Tables"]["integration_audit_logs"]["Insert"];
export type IntegrationCredentialInsert =
  Database["public"]["Tables"]["integration_credentials"]["Insert"];
export type IntegrationInsert =
  Database["public"]["Tables"]["integrations"]["Insert"];
export type MonthlySummaryInsert =
  Database["public"]["Tables"]["monthly_summaries"]["Insert"];
export type PendingCalendarSyncInsert =
  Database["public"]["Tables"]["pending_calendar_syncs"]["Insert"];
export type TaskInsert = Database["public"]["Tables"]["tasks"]["Insert"];
export type TaskEventInsert =
  Database["public"]["Tables"]["task_events"]["Insert"];
export type UserSignalInsert =
  Database["public"]["Tables"]["user_signals"]["Insert"];
export type UserInsert = Database["public"]["Tables"]["users"]["Insert"];
export type WeeklySummaryInsert =
  Database["public"]["Tables"]["weekly_summaries"]["Insert"];

// ============================================================================
// Table Update Types
// ============================================================================

export type ActivityAtomUpdate =
  Database["public"]["Tables"]["activity_atoms"]["Update"];
export type AskMessageUpdate =
  Database["public"]["Tables"]["ask_messages"]["Update"];
export type AskThreadUpdate =
  Database["public"]["Tables"]["ask_threads"]["Update"];
export type CalendarWatchUpdate =
  Database["public"]["Tables"]["calendar_watches"]["Update"];
export type DailyEventUpdate =
  Database["public"]["Tables"]["daily_events"]["Update"];
export type DailySummaryUpdate =
  Database["public"]["Tables"]["daily_summaries"]["Update"];
export type EmbeddingUpdate =
  Database["public"]["Tables"]["embeddings"]["Update"];
export type InsightSourceUpdate =
  Database["public"]["Tables"]["insight_sources"]["Update"];
export type IntegrationAuditLogUpdate =
  Database["public"]["Tables"]["integration_audit_logs"]["Update"];
export type IntegrationCredentialUpdate =
  Database["public"]["Tables"]["integration_credentials"]["Update"];
export type IntegrationUpdate =
  Database["public"]["Tables"]["integrations"]["Update"];
export type MonthlySummaryUpdate =
  Database["public"]["Tables"]["monthly_summaries"]["Update"];
export type PendingCalendarSyncUpdate =
  Database["public"]["Tables"]["pending_calendar_syncs"]["Update"];
export type TaskUpdate = Database["public"]["Tables"]["tasks"]["Update"];
export type TaskEventUpdate =
  Database["public"]["Tables"]["task_events"]["Update"];
export type UserSignalUpdate =
  Database["public"]["Tables"]["user_signals"]["Update"];
export type UserUpdate = Database["public"]["Tables"]["users"]["Update"];
export type WeeklySummaryUpdate =
  Database["public"]["Tables"]["weekly_summaries"]["Update"];

// ============================================================================
// Enum-like String Literal Union Types
// ============================================================================

// Activity Atom Types
export type ActivityAtomType = ActivityAtom["atom_type"];
export type ActivityAtomImportance = NonNullable<ActivityAtom["importance"]>;
export type ActivityAtomSentiment = NonNullable<ActivityAtom["sentiment"]>;
export type ActivityAtomProvider = ActivityAtom["provider"];

// Ask Message Types
export type AskMessageRole = AskMessage["role"];

// Daily Event Types
export type DailyEventRole = DailyEvent["role"];
export type DailyEventType = DailyEvent["type"];
export type DailyEventSubtype = NonNullable<DailyEvent["subtype"]>;

// Integration Types
export type IntegrationProvider = Integration["provider"];
export type IntegrationStatus = Integration["status"];
export type IntegrationSyncStatus = NonNullable<
  Integration["last_sync_status"]
>;

// Integration Audit Log Types
export type IntegrationAuditLogEvent = IntegrationAuditLog["event"];
export type IntegrationAuditLogProvider = IntegrationAuditLog["provider"];

// Task Types
export type TaskStatus = Task["status"];
export type TaskType = Task["task_type"];
export type TaskEventType = TaskEvent["event_type"];

// User Signal Types
export type UserSignalType = UserSignal["signal_type"];
export type UserSignalImpactArea = NonNullable<UserSignal["impact_area"]>;

// Insight Source Types
export type InsightSourceGranularity = InsightSource["granularity"];
export type InsightSourceType = InsightSource["source_type"];

// ============================================================================
// Extended Types (Common Joins)
// ============================================================================

// Activity Atom with related entities
export type ActivityAtomWithEmbedding = ActivityAtom & {
  embedding: Embedding | null;
};
export type ActivityAtomWithIntegration = ActivityAtom & {
  integration: Integration | null;
};
export type ActivityAtomWithUser = ActivityAtom & {
  user: User;
};
export type ActivityAtomWithRelations = ActivityAtom & {
  embedding: Embedding | null;
  integration: Integration | null;
  user: User;
};

// Ask Message with thread
export type AskMessageWithThread = AskMessage & {
  thread: AskThread;
};

// Ask Thread with messages
export type AskThreadWithMessages = AskThread & {
  messages: AskMessage[];
};

// Calendar Watch with integration
export type CalendarWatchWithIntegration = CalendarWatch & {
  integration: Integration;
};

// Daily Event with user
export type DailyEventWithUser = DailyEvent & {
  user: User;
};

// Daily Summary with user
export type DailySummaryWithUser = DailySummary & {
  user: User;
};

// Embedding with user
export type EmbeddingWithUser = Embedding & {
  user: User;
};

// Insight Source with related entities
export type InsightSourceWithEmbedding = InsightSource & {
  embedding: Embedding | null;
};
export type InsightSourceWithUser = InsightSource & {
  user: User;
};
export type InsightSourceWithRelations = InsightSource & {
  embedding: Embedding | null;
  user: User;
};

// Integration with related entities
export type IntegrationWithUser = Integration & {
  user: User;
};
export type IntegrationWithCredential = Integration & {
  credential: IntegrationCredential | null;
};
export type IntegrationWithRelations = Integration & {
  user: User;
  credential: IntegrationCredential | null;
};

// Integration Audit Log with related entities
export type IntegrationAuditLogWithIntegration = IntegrationAuditLog & {
  integration: Integration | null;
};
export type IntegrationAuditLogWithUser = IntegrationAuditLog & {
  user: User;
};
export type IntegrationAuditLogWithRelations = IntegrationAuditLog & {
  integration: Integration | null;
  user: User;
};

// Integration Credential with integration
export type IntegrationCredentialWithIntegration = IntegrationCredential & {
  integration: Integration;
};

// Monthly Summary with user
export type MonthlySummaryWithUser = MonthlySummary & {
  user: User;
};

// Pending Calendar Sync with integration
export type PendingCalendarSyncWithIntegration = PendingCalendarSync & {
  integration: Integration;
};

// Task with related entities
export type TaskWithUser = Task & {
  user: User;
};
export type TaskWithParent = Task & {
  parent_task: Task | null;
};
export type TaskWithRelations = Task & {
  user: User;
  parent_task: Task | null;
};

// User Signal with related entities
export type UserSignalWithEmbedding = UserSignal & {
  embedding: Embedding | null;
};
export type UserSignalWithUser = UserSignal & {
  user: User;
};
export type UserSignalWithRelations = UserSignal & {
  embedding: Embedding | null;
  user: User;
};

// Weekly Summary with user
export type WeeklySummaryWithUser = WeeklySummary & {
  user: User;
};

// User with related entities
export type UserWithIntegrations = User & {
  integrations: Integration[];
};
export type UserWithActivityAtoms = User & {
  activity_atoms: ActivityAtom[];
};
export type UserWithSignals = User & {
  signals: UserSignal[];
};
export type UserWithSummaries = User & {
  daily_summaries: DailySummary[];
  weekly_summaries: WeeklySummary[];
  monthly_summaries: MonthlySummary[];
};

// ============================================================================
// Form Data Interfaces
// ============================================================================

export interface UserProfileFormData {
  fullName: string | null;
  email: string | null;
  timezone: string | null;
}

export interface IntegrationFormData {
  provider: IntegrationProvider;
  externalEmail?: string | null;
  scopes?: string[] | null;
}

export interface ActivityAtomFormData {
  atomType: ActivityAtomType;
  content: string;
  provider: ActivityAtomProvider;
  occurredAt: string;
  externalId: string;
  title?: string | null;
  durationMinutes?: number | null;
  categories?: string[] | null;
  participants?: string[] | null;
  sentiment?: ActivityAtomSentiment | null;
  importance?: ActivityAtomImportance | null;
  sourceUrl?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface TaskFormData {
  taskType: TaskType;
  sessionId: string;
  status: TaskStatus;
  input: Record<string, unknown>;
  parentTaskId?: string | null;
  retryCount?: number;
}

export interface UserSignalFormData {
  signalType: UserSignalType;
  description: string;
  confidence?: number | null;
  impactArea?: UserSignalImpactArea | null;
  themes?: string[] | null;
  evidenceStart?: string | null;
  evidenceEnd?: string | null;
  expiresAt?: string | null;
  sourceAtomIds?: string[] | null;
}

export interface InsightSourceFormData {
  sourceType: InsightSourceType;
  granularity: InsightSourceGranularity;
  summary: string;
  periodStart: string;
  periodEnd: string;
  keyFacts?: Record<string, unknown> | null;
  actionableInsights?: Record<string, unknown> | null;
  relatedAtomIds?: string[] | null;
  relatedSignalIds?: string[] | null;
  metadata?: Record<string, unknown> | null;
}

export interface AskThreadFormData {
  title?: string | null;
}

export interface AskMessageFormData {
  content: string;
  role: AskMessageRole;
  threadId: string;
}

export interface DailyEventFormData {
  type: DailyEventType;
  role: DailyEventRole;
  content: string;
  date: string;
  subtype?: DailyEventSubtype | null;
}

export interface SummaryFormData {
  content: Record<string, unknown>;
}

export interface DailySummaryFormData extends SummaryFormData {
  date: string;
}

export interface WeeklySummaryFormData extends SummaryFormData {
  weekStart: string;
}

export interface MonthlySummaryFormData extends SummaryFormData {
  monthStart: string;
}
