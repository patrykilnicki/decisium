import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/types/supabase';
import type { InsightSourceInsert } from '@/types/database';
import { generateEmbedding } from '@/lib/embeddings/generate';
import { StoredActivityAtom } from './sync-pipeline';

// ============================================
// Types
// ============================================

export interface InsightSource {
  id: string;
  userId: string;
  sourceType: 'daily_digest' | 'weekly_pattern' | 'integration_summary';
  granularity: 'day' | 'week' | 'month';
  periodStart: Date;
  periodEnd: Date;
  summary: string;
  keyFacts: string[];
  actionableInsights: string[];
  relatedAtomIds: string[];
  relatedSignalIds: string[];
  embeddingId?: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface GenerateInsightOptions {
  granularity: 'day' | 'week' | 'month';
  periodStart: Date;
  periodEnd: Date;
  provider?: string;
  forceRegenerate?: boolean;
}

export interface CalendarInsight {
  totalEvents: number;
  totalMeetings: number;
  totalMeetingMinutes: number;
  busyDays: string[];
  quietDays: string[];
  topParticipants: Array<{ name: string; count: number }>;
  eventsByDay: Record<string, number>;
  averageEventsPerDay: number;
  patterns: string[];
}

// ============================================
// Insight Generator Class
// ============================================

export class InsightGenerator {
  private supabase: SupabaseClient<Database>;

  constructor(supabase: SupabaseClient<Database>) {
    this.supabase = supabase;
  }

  /**
   * Generate insights from activity atoms for a time period
   */
  async generateInsights(
    userId: string,
    options: GenerateInsightOptions
  ): Promise<InsightSource> {
    const { granularity, periodStart, periodEnd, provider, forceRegenerate } = options;

    // Check if insight already exists
    if (!forceRegenerate) {
      const existing = await this.getExistingInsight(
        userId,
        'integration_summary',
        granularity,
        periodStart
      );
      if (existing) {
        return existing;
      }
    }

    // Fetch atoms for the period
    const atoms = await this.fetchAtomsForPeriod(userId, periodStart, periodEnd, provider);

    if (atoms.length === 0) {
      // Create empty insight
      return this.createInsightSource(userId, {
        sourceType: 'integration_summary',
        granularity,
        periodStart,
        periodEnd,
        summary: 'No activity data for this period.',
        keyFacts: [],
        actionableInsights: [],
        relatedAtomIds: [],
        metadata: { provider, atomCount: 0 },
      });
    }

    // Analyze atoms and generate insights
    const analysis = this.analyzeAtoms(atoms);

    // Generate summary and insights
    const { summary, keyFacts, actionableInsights } = this.generateSummaryFromAnalysis(
      analysis,
      granularity,
      periodStart,
      periodEnd
    );

    // Create insight source
    const insightSource = await this.createInsightSource(userId, {
      sourceType: 'integration_summary',
      granularity,
      periodStart,
      periodEnd,
      summary,
      keyFacts,
      actionableInsights,
      relatedAtomIds: atoms.map((a) => a.id),
      metadata: {
        provider,
        atomCount: atoms.length,
        analysis,
      },
    });

    return insightSource;
  }

  /**
   * Generate daily digest for a user
   */
  async generateDailyDigest(
    userId: string,
    date: Date
  ): Promise<InsightSource> {
    const periodStart = new Date(date);
    periodStart.setHours(0, 0, 0, 0);

    const periodEnd = new Date(date);
    periodEnd.setHours(23, 59, 59, 999);

    return this.generateInsights(userId, {
      granularity: 'day',
      periodStart,
      periodEnd,
    });
  }

  /**
   * Generate weekly pattern analysis
   */
  async generateWeeklyPattern(
    userId: string,
    weekStart: Date
  ): Promise<InsightSource> {
    const periodStart = new Date(weekStart);
    periodStart.setHours(0, 0, 0, 0);

    const periodEnd = new Date(weekStart);
    periodEnd.setDate(periodEnd.getDate() + 6);
    periodEnd.setHours(23, 59, 59, 999);

    const atoms = await this.fetchAtomsForPeriod(userId, periodStart, periodEnd);
    const analysis = this.analyzeAtoms(atoms);

    // Detect weekly patterns
    const patterns = this.detectWeeklyPatterns(atoms, analysis);

    const { summary, keyFacts, actionableInsights } = this.generateWeeklySummary(
      analysis,
      patterns,
      periodStart,
      periodEnd
    );

    return this.createInsightSource(userId, {
      sourceType: 'weekly_pattern',
      granularity: 'week',
      periodStart,
      periodEnd,
      summary,
      keyFacts,
      actionableInsights,
      relatedAtomIds: atoms.map((a) => a.id),
      metadata: {
        atomCount: atoms.length,
        analysis,
        patterns,
      },
    });
  }

  // ─────────────────────────────────────────────
  // Analysis Methods
  // ─────────────────────────────────────────────

  private analyzeAtoms(atoms: StoredActivityAtom[]): CalendarInsight {
    // Filter calendar events
    const events = atoms.filter((a) => a.atomType === 'event');
    const meetings = events.filter((a) => 
      a.participants && a.participants.length > 0
    );

    // Calculate total meeting time
    const totalMeetingMinutes = meetings.reduce(
      (sum, m) => sum + (m.durationMinutes || 0),
      0
    );

    // Group by day
    const eventsByDay: Record<string, number> = {};
    for (const event of events) {
      const day = event.occurredAt.toISOString().split('T')[0];
      eventsByDay[day] = (eventsByDay[day] || 0) + 1;
    }

    // Find busy and quiet days
    const dayEntries = Object.entries(eventsByDay);
    const sortedByCount = [...dayEntries].sort((a, b) => b[1] - a[1]);
    const busyDays = sortedByCount.slice(0, 3).map(([day]) => day);
    const quietDays = sortedByCount.slice(-3).map(([day]) => day);

    // Count participants
    const participantCounts: Record<string, number> = {};
    for (const event of events) {
      for (const participant of event.participants || []) {
        participantCounts[participant] = (participantCounts[participant] || 0) + 1;
      }
    }

    const topParticipants = Object.entries(participantCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    // Calculate average
    const uniqueDays = Object.keys(eventsByDay).length;
    const averageEventsPerDay = uniqueDays > 0
      ? Math.round((events.length / uniqueDays) * 10) / 10
      : 0;

    // Detect patterns
    const patterns = this.detectPatterns(events, eventsByDay);

    return {
      totalEvents: events.length,
      totalMeetings: meetings.length,
      totalMeetingMinutes,
      busyDays,
      quietDays,
      topParticipants,
      eventsByDay,
      averageEventsPerDay,
      patterns,
    };
  }

  private detectPatterns(
    events: StoredActivityAtom[],
    eventsByDay: Record<string, number>
  ): string[] {
    const patterns: string[] = [];

    // Check for meeting-heavy schedule
    const meetingEvents = events.filter((e) => 
      e.participants && e.participants.length > 0
    );
    const meetingRatio = events.length > 0
      ? meetingEvents.length / events.length
      : 0;

    if (meetingRatio > 0.7) {
      patterns.push('Meeting-heavy schedule with limited focus time');
    } else if (meetingRatio < 0.3) {
      patterns.push('Good balance of meetings and focus time');
    }

    // Check for back-to-back meetings
    const sortedEvents = [...events].sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()
    );
    let backToBackCount = 0;
    for (let i = 1; i < sortedEvents.length; i++) {
      const prev = sortedEvents[i - 1];
      const curr = sortedEvents[i];
      const prevEnd = prev.occurredAt.getTime() + (prev.durationMinutes || 0) * 60000;
      const gap = curr.occurredAt.getTime() - prevEnd;
      if (gap < 15 * 60000) { // Less than 15 minutes gap
        backToBackCount++;
      }
    }
    if (backToBackCount > 3) {
      patterns.push('Frequent back-to-back meetings with little buffer time');
    }

    // Check day distribution
    const dayValues = Object.values(eventsByDay);
    const maxEvents = Math.max(...dayValues, 0);
    const minEvents = Math.min(...dayValues, 0);
    if (maxEvents - minEvents > 5) {
      patterns.push('Uneven distribution of events across days');
    }

    return patterns;
  }

  private detectWeeklyPatterns(
    atoms: StoredActivityAtom[],
    analysis: CalendarInsight
  ): string[] {
    const patterns = [...analysis.patterns];

    // Day of week analysis
    const byDayOfWeek: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    for (const atom of atoms) {
      const day = atom.occurredAt.getDay();
      byDayOfWeek[day]++;
    }

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const sortedDays = Object.entries(byDayOfWeek)
      .sort((a, b) => b[1] - a[1]);

    if (sortedDays[0][1] > sortedDays[sortedDays.length - 1][1] * 2) {
      patterns.push(
        `${dayNames[parseInt(sortedDays[0][0])]} is your busiest day`
      );
    }

    // Weekend vs weekday
    const weekendEvents = byDayOfWeek[0] + byDayOfWeek[6];
    const weekdayEvents = byDayOfWeek[1] + byDayOfWeek[2] + byDayOfWeek[3] + byDayOfWeek[4] + byDayOfWeek[5];

    if (weekendEvents > weekdayEvents * 0.3) {
      patterns.push('Significant weekend activity detected');
    }

    return patterns;
  }

  // ─────────────────────────────────────────────
  // Summary Generation
  // ─────────────────────────────────────────────

  private generateSummaryFromAnalysis(
    analysis: CalendarInsight,
    granularity: 'day' | 'week' | 'month',
    periodStart: Date,
    periodEnd: Date
  ): { summary: string; keyFacts: string[]; actionableInsights: string[] } {
    const periodLabel = granularity === 'day'
      ? periodStart.toLocaleDateString()
      : `${periodStart.toLocaleDateString()} - ${periodEnd.toLocaleDateString()}`;

    // Build summary
    const summaryParts: string[] = [];
    summaryParts.push(`Calendar overview for ${periodLabel}:`);
    summaryParts.push(`${analysis.totalEvents} total events, including ${analysis.totalMeetings} meetings.`);

    if (analysis.totalMeetingMinutes > 0) {
      const hours = Math.round(analysis.totalMeetingMinutes / 60 * 10) / 10;
      summaryParts.push(`Total meeting time: ${hours} hours.`);
    }

    if (analysis.patterns.length > 0) {
      summaryParts.push(`Patterns: ${analysis.patterns.join('. ')}.`);
    }

    // Key facts
    const keyFacts: string[] = [];
    keyFacts.push(`${analysis.totalEvents} events`);
    keyFacts.push(`${analysis.totalMeetings} meetings`);
    keyFacts.push(`${Math.round(analysis.totalMeetingMinutes / 60)} hours in meetings`);
    keyFacts.push(`Average ${analysis.averageEventsPerDay} events per day`);

    if (analysis.topParticipants.length > 0) {
      keyFacts.push(
        `Top collaborator: ${analysis.topParticipants[0].name} (${analysis.topParticipants[0].count} meetings)`
      );
    }

    // Actionable insights
    const actionableInsights: string[] = [];

    if (analysis.patterns.includes('Meeting-heavy schedule with limited focus time')) {
      actionableInsights.push('Consider blocking focus time on your calendar');
    }

    if (analysis.patterns.includes('Frequent back-to-back meetings with little buffer time')) {
      actionableInsights.push('Try to add 15-minute buffers between meetings');
    }

    if (analysis.busyDays.length > 0) {
      actionableInsights.push(
        `Your busiest days are ${analysis.busyDays.slice(0, 2).join(' and ')} - plan deep work for quieter days`
      );
    }

    return {
      summary: summaryParts.join(' '),
      keyFacts,
      actionableInsights,
    };
  }

  private generateWeeklySummary(
    analysis: CalendarInsight,
    patterns: string[],
    periodStart: Date,
    periodEnd: Date
  ): { summary: string; keyFacts: string[]; actionableInsights: string[] } {
    const base = this.generateSummaryFromAnalysis(analysis, 'week', periodStart, periodEnd);

    // Add weekly-specific insights
    if (patterns.length > 0) {
      base.keyFacts.push(`Weekly patterns: ${patterns.join('; ')}`);
    }

    return base;
  }

  // ─────────────────────────────────────────────
  // Database Operations
  // ─────────────────────────────────────────────

  private async fetchAtomsForPeriod(
    userId: string,
    periodStart: Date,
    periodEnd: Date,
    provider?: string
  ): Promise<StoredActivityAtom[]> {
    let query = this.supabase
      .from('activity_atoms')
      .select('*')
      .eq('user_id', userId)
      .gte('occurred_at', periodStart.toISOString())
      .lte('occurred_at', periodEnd.toISOString())
      .order('occurred_at', { ascending: true });

    if (provider) {
      query = query.eq('provider', provider);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch atoms: ${error.message}`);
    }

    return (data || []).map(this.mapStoredAtom);
  }

  private async getExistingInsight(
    userId: string,
    sourceType: string,
    granularity: string,
    periodStart: Date
  ): Promise<InsightSource | null> {
    const { data, error } = await this.supabase
      .from('insight_sources')
      .select('*')
      .eq('user_id', userId)
      .eq('source_type', sourceType)
      .eq('granularity', granularity)
      .eq('period_start', periodStart.toISOString().split('T')[0])
      .single();

    if (error || !data) {
      return null;
    }

    return this.mapInsightSource(data);
  }

  private async createInsightSource(
    userId: string,
    data: {
      sourceType: 'daily_digest' | 'weekly_pattern' | 'integration_summary';
      granularity: 'day' | 'week' | 'month';
      periodStart: Date;
      periodEnd: Date;
      summary: string;
      keyFacts: string[];
      actionableInsights: string[];
      relatedAtomIds: string[];
      relatedSignalIds?: string[];
      metadata?: Record<string, unknown>;
    }
  ): Promise<InsightSource> {
    // Generate embedding for the summary
    let embeddingId: string | undefined;
    try {
      const { embedding } = await generateEmbedding(data.summary);
      // Convert number array to PostgreSQL array string format for pgvector
      const embeddingString = `[${embedding.join(",")}]`;
      const { data: embeddingData, error: embeddingError } = await this.supabase
        .from('embeddings')
        .insert({
          user_id: userId,
          content: data.summary,
          embedding: embeddingString,
          metadata: {
            type: 'insight_source',
            source_type: data.sourceType,
            granularity: data.granularity,
            period_start: data.periodStart.toISOString().split('T')[0],
          } as Json,
        })
        .select('id')
        .single();

      if (!embeddingError && embeddingData) {
        embeddingId = embeddingData.id;
      }
    } catch (error) {
      console.error('Error generating embedding for insight:', error);
    }

    // Insert insight source
    // Convert Record<string, unknown> to Json type for proper typing
    const metadataJson: Json = (data.metadata || {}) as Json;
    const insertData: InsightSourceInsert = {
      user_id: userId,
      source_type: data.sourceType,
      granularity: data.granularity,
      period_start: data.periodStart.toISOString().split('T')[0],
      period_end: data.periodEnd.toISOString().split('T')[0],
      summary: data.summary,
      key_facts: data.keyFacts as Json,
      actionable_insights: data.actionableInsights as Json,
      related_atom_ids: data.relatedAtomIds,
      related_signal_ids: data.relatedSignalIds || [],
      embedding_id: embeddingId,
      metadata: metadataJson,
    };

    const { data: insightData, error: insertError } = await this.supabase
      .from('insight_sources')
      .upsert(insertData, {
        onConflict: 'user_id,source_type,granularity,period_start',
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(`Failed to create insight source: ${insertError.message}`);
    }

    return this.mapInsightSource(insightData);
  }

  /**
   * Get recent insights for a user
   */
  async getRecentInsights(
    userId: string,
    options?: {
      sourceType?: string;
      granularity?: string;
      limit?: number;
    }
  ): Promise<InsightSource[]> {
    let query = this.supabase
      .from('insight_sources')
      .select('*')
      .eq('user_id', userId)
      .order('period_start', { ascending: false });

    if (options?.sourceType) {
      query = query.eq('source_type', options.sourceType);
    }

    if (options?.granularity) {
      query = query.eq('granularity', options.granularity);
    }

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch insights: ${error.message}`);
    }

    return (data || []).map(this.mapInsightSource);
  }

  private mapStoredAtom(data: Record<string, unknown>): StoredActivityAtom {
    return {
      id: data.id as string,
      userId: data.user_id as string,
      integrationId: data.integration_id as string,
      provider: data.provider as StoredActivityAtom['provider'],
      externalId: data.external_id as string,
      atomType: data.atom_type as string,
      title: data.title as string | undefined,
      content: data.content as string,
      occurredAt: new Date(data.occurred_at as string),
      durationMinutes: data.duration_minutes as number | undefined,
      participants: data.participants as string[] | undefined,
      sourceUrl: data.source_url as string | undefined,
      embeddingId: data.embedding_id as string | undefined,
      metadata: (data.metadata as Record<string, unknown>) || {},
      syncedAt: new Date(data.synced_at as string),
    };
  }

  private mapInsightSource(data: Record<string, unknown>): InsightSource {
    return {
      id: data.id as string,
      userId: data.user_id as string,
      sourceType: data.source_type as InsightSource['sourceType'],
      granularity: data.granularity as InsightSource['granularity'],
      periodStart: new Date(data.period_start as string),
      periodEnd: new Date(data.period_end as string),
      summary: data.summary as string,
      keyFacts: (data.key_facts as string[]) || [],
      actionableInsights: (data.actionable_insights as string[]) || [],
      relatedAtomIds: (data.related_atom_ids as string[]) || [],
      relatedSignalIds: (data.related_signal_ids as string[]) || [],
      embeddingId: data.embedding_id as string | undefined,
      metadata: (data.metadata as Record<string, unknown>) || {},
      createdAt: new Date(data.created_at as string),
    };
  }
}

/**
 * Create an InsightGenerator instance
 */
export function createInsightGenerator(supabase: SupabaseClient<Database>): InsightGenerator {
  return new InsightGenerator(supabase);
}
