export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      activity_atoms: {
        Row: {
          atom_type: string
          categories: string[] | null
          content: string
          created_at: string | null
          duration_minutes: number | null
          embedding_id: string | null
          external_id: string
          id: string
          importance: string | null
          integration_id: string | null
          metadata: Json | null
          occurred_at: string
          participants: string[] | null
          provider: string
          related_atom_ids: string[] | null
          sentiment: string | null
          source_url: string | null
          synced_at: string | null
          title: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          atom_type: string
          categories?: string[] | null
          content: string
          created_at?: string | null
          duration_minutes?: number | null
          embedding_id?: string | null
          external_id: string
          id?: string
          importance?: string | null
          integration_id?: string | null
          metadata?: Json | null
          occurred_at: string
          participants?: string[] | null
          provider: string
          related_atom_ids?: string[] | null
          sentiment?: string | null
          source_url?: string | null
          synced_at?: string | null
          title?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          atom_type?: string
          categories?: string[] | null
          content?: string
          created_at?: string | null
          duration_minutes?: number | null
          embedding_id?: string | null
          external_id?: string
          id?: string
          importance?: string | null
          integration_id?: string | null
          metadata?: Json | null
          occurred_at?: string
          participants?: string[] | null
          provider?: string
          related_atom_ids?: string[] | null
          sentiment?: string | null
          source_url?: string | null
          synced_at?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_atoms_embedding_id_fkey"
            columns: ["embedding_id"]
            isOneToOne: false
            referencedRelation: "embeddings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_atoms_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_atoms_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ask_messages: {
        Row: {
          content: string
          created_at: string | null
          id: string
          role: string
          thread_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          role: string
          thread_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          role?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ask_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "ask_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      ask_threads: {
        Row: {
          created_at: string | null
          id: string
          title: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          title?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          title?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ask_threads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_watches: {
        Row: {
          calendar_id: string
          channel_id: string
          created_at: string | null
          expiration_ms: number
          id: string
          integration_id: string
          resource_id: string
          resource_uri: string | null
          sync_token: string | null
          updated_at: string | null
        }
        Insert: {
          calendar_id?: string
          channel_id: string
          created_at?: string | null
          expiration_ms: number
          id?: string
          integration_id: string
          resource_id: string
          resource_uri?: string | null
          sync_token?: string | null
          updated_at?: string | null
        }
        Update: {
          calendar_id?: string
          channel_id?: string
          created_at?: string | null
          expiration_ms?: number
          id?: string
          integration_id?: string
          resource_id?: string
          resource_uri?: string | null
          sync_token?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_watches_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_events: {
        Row: {
          content: string
          created_at: string | null
          date: string
          id: string
          role: string
          subtype: string | null
          type: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          date: string
          id?: string
          role: string
          subtype?: string | null
          type: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          date?: string
          id?: string
          role?: string
          subtype?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_summaries: {
        Row: {
          content: Json
          created_at: string | null
          date: string
          id: string
          user_id: string
        }
        Insert: {
          content: Json
          created_at?: string | null
          date: string
          id?: string
          user_id: string
        }
        Update: {
          content?: Json
          created_at?: string | null
          date?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_summaries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      embeddings: {
        Row: {
          content: string
          created_at: string | null
          embedding: string | null
          id: string
          metadata: Json | null
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          embedding?: string | null
          id?: string
          metadata?: Json | null
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          embedding?: string | null
          id?: string
          metadata?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "embeddings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      insight_sources: {
        Row: {
          actionable_insights: Json | null
          created_at: string | null
          embedding_id: string | null
          granularity: string
          id: string
          key_facts: Json | null
          metadata: Json | null
          period_end: string
          period_start: string
          related_atom_ids: string[] | null
          related_signal_ids: string[] | null
          source_type: string
          summary: string
          user_id: string
        }
        Insert: {
          actionable_insights?: Json | null
          created_at?: string | null
          embedding_id?: string | null
          granularity: string
          id?: string
          key_facts?: Json | null
          metadata?: Json | null
          period_end: string
          period_start: string
          related_atom_ids?: string[] | null
          related_signal_ids?: string[] | null
          source_type: string
          summary: string
          user_id: string
        }
        Update: {
          actionable_insights?: Json | null
          created_at?: string | null
          embedding_id?: string | null
          granularity?: string
          id?: string
          key_facts?: Json | null
          metadata?: Json | null
          period_end?: string
          period_start?: string
          related_atom_ids?: string[] | null
          related_signal_ids?: string[] | null
          source_type?: string
          summary?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "insight_sources_embedding_id_fkey"
            columns: ["embedding_id"]
            isOneToOne: false
            referencedRelation: "embeddings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insight_sources_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_audit_logs: {
        Row: {
          created_at: string | null
          event: string
          id: string
          integration_id: string | null
          metadata: Json | null
          provider: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          event: string
          id?: string
          integration_id?: string | null
          metadata?: Json | null
          provider: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          event?: string
          id?: string
          integration_id?: string | null
          metadata?: Json | null
          provider?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_audit_logs_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_credentials: {
        Row: {
          access_token_encrypted: string
          created_at: string | null
          expires_at: string | null
          id: string
          integration_id: string
          refresh_token_encrypted: string | null
          token_type: string | null
          updated_at: string | null
        }
        Insert: {
          access_token_encrypted: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          integration_id: string
          refresh_token_encrypted?: string | null
          token_type?: string | null
          updated_at?: string | null
        }
        Update: {
          access_token_encrypted?: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          integration_id?: string
          refresh_token_encrypted?: string | null
          token_type?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_credentials_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: true
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          connected_at: string | null
          created_at: string | null
          external_email: string | null
          external_user_id: string | null
          id: string
          last_sync_at: string | null
          last_sync_error: string | null
          last_sync_status: string | null
          metadata: Json | null
          provider: string
          scopes: string[] | null
          status: string
          sync_cursor: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          connected_at?: string | null
          created_at?: string | null
          external_email?: string | null
          external_user_id?: string | null
          id?: string
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          metadata?: Json | null
          provider: string
          scopes?: string[] | null
          status?: string
          sync_cursor?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          connected_at?: string | null
          created_at?: string | null
          external_email?: string | null
          external_user_id?: string | null
          id?: string
          last_sync_at?: string | null
          last_sync_error?: string | null
          last_sync_status?: string | null
          metadata?: Json | null
          provider?: string
          scopes?: string[] | null
          status?: string
          sync_cursor?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_summaries: {
        Row: {
          content: Json
          created_at: string | null
          id: string
          month_start: string
          user_id: string
        }
        Insert: {
          content: Json
          created_at?: string | null
          id?: string
          month_start: string
          user_id: string
        }
        Update: {
          content?: Json
          created_at?: string | null
          id?: string
          month_start?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "monthly_summaries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_calendar_syncs: {
        Row: {
          created_at: string | null
          integration_id: string
          sync_token: string | null
        }
        Insert: {
          created_at?: string | null
          integration_id: string
          sync_token?: string | null
        }
        Update: {
          created_at?: string | null
          integration_id?: string
          sync_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pending_calendar_syncs_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: true
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          created_at: string | null
          id: string
          input: Json
          last_error: string | null
          output: Json | null
          parent_task_id: string | null
          retry_count: number
          session_id: string
          status: string
          task_type: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          input?: Json
          last_error?: string | null
          output?: Json | null
          parent_task_id?: string | null
          retry_count?: number
          session_id: string
          status: string
          task_type: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          input?: Json
          last_error?: string | null
          output?: Json | null
          parent_task_id?: string | null
          retry_count?: number
          session_id?: string
          status?: string
          task_type?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_signals: {
        Row: {
          confidence: number | null
          created_at: string | null
          description: string
          embedding_id: string | null
          evidence_end: string | null
          evidence_start: string | null
          expires_at: string | null
          id: string
          impact_area: string | null
          signal_type: string
          source_atom_ids: string[] | null
          themes: string[] | null
          user_id: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string | null
          description: string
          embedding_id?: string | null
          evidence_end?: string | null
          evidence_start?: string | null
          expires_at?: string | null
          id?: string
          impact_area?: string | null
          signal_type: string
          source_atom_ids?: string[] | null
          themes?: string[] | null
          user_id: string
        }
        Update: {
          confidence?: number | null
          created_at?: string | null
          description?: string
          embedding_id?: string | null
          evidence_end?: string | null
          evidence_start?: string | null
          expires_at?: string | null
          id?: string
          impact_area?: string | null
          signal_type?: string
          source_atom_ids?: string[] | null
          themes?: string[] | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_signals_embedding_id_fkey"
            columns: ["embedding_id"]
            isOneToOne: false
            referencedRelation: "embeddings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_signals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string | null
          email: string | null
          full_name: string | null
          id: string
          onboarding_completed: boolean | null
          onboarding_completed_at: string | null
          timezone: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          onboarding_completed?: boolean | null
          onboarding_completed_at?: string | null
          timezone?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          onboarding_completed?: boolean | null
          onboarding_completed_at?: string | null
          timezone?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      weekly_summaries: {
        Row: {
          content: Json
          created_at: string | null
          id: string
          user_id: string
          week_start: string
        }
        Insert: {
          content: Json
          created_at?: string | null
          id?: string
          user_id: string
          week_start: string
        }
        Update: {
          content?: Json
          created_at?: string | null
          id?: string
          user_id?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_summaries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_tasks: {
        Args: { max_tasks?: number; stale_after_seconds?: number }
        Returns: {
          created_at: string | null
          id: string
          input: Json
          last_error: string | null
          output: Json | null
          parent_task_id: string | null
          retry_count: number
          session_id: string
          status: string
          task_type: string
          updated_at: string | null
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      match_activity_atoms: {
        Args: {
          filter_atom_type?: string
          filter_provider?: string
          match_count?: number
          match_threshold?: number
          match_user_id: string
          query_embedding: string
        }
        Returns: {
          atom_type: string
          content: string
          id: string
          occurred_at: string
          provider: string
          similarity: number
          source_url: string
          title: string
          user_id: string
        }[]
      }
      match_embeddings: {
        Args: {
          match_count?: number
          match_threshold?: number
          match_type?: string
          match_user_id: string
          query_embedding: string
        }
        Returns: {
          content: string
          created_at: string
          id: string
          metadata: Json
          similarity: number
          user_id: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
