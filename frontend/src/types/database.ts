/**
 * Database types for the Supabase schema.
 *
 * Hand-written to match backend/supabase/migrations. Once the Supabase project
 * is linked you can regenerate this file with:
 *   npx supabase gen types typescript --project-id <project-ref> --schema public > src/types/database.ts
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type AppRole = "admin" | "employee";

/** Matches employee_categories.slug. New categories can be added in the DB. */
export type EmployeeCategorySlug = "nurse" | "beauty_therapist" | (string & {});

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string;
          email: string;
          role: AppRole;
          employee_category: EmployeeCategorySlug | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: {
          full_name?: string;
          role?: AppRole;
          employee_category?: EmployeeCategorySlug | null;
          is_active?: boolean;
        };
        Relationships: [];
      };
      employee_categories: {
        Row: {
          id: string;
          slug: EmployeeCategorySlug;
          name: string;
          description: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          description?: string | null;
          created_at?: string;
        };
        Update: {
          slug?: string;
          name?: string;
          description?: string | null;
        };
        Relationships: [];
      };
      audit_logs: {
        Row: {
          id: string;
          user_id: string | null;
          action: string;
          entity_type: string;
          entity_id: string | null;
          details: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          action: string;
          entity_type: string;
          entity_id?: string | null;
          details?: Json;
          created_at?: string;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "audit_logs_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      metric_definitions: {
        Row: MetricDefinition;
        Insert: Partial<Omit<MetricDefinition, "id" | "created_at" | "updated_at">> &
          Pick<MetricDefinition, "category" | "key" | "name">;
        Update: Partial<Omit<MetricDefinition, "id" | "category" | "key" | "kind" | "created_at" | "updated_at">>;
        Relationships: [];
      };
      metric_entries: {
        Row: MetricEntry;
        Insert: { employee_id: string; entry_date: string };
        /** Review fields are accepted from admins only (enforced by the database). */
        Update: { status?: EntryStatus; review_note?: string | null; final_rejection?: boolean };
        Relationships: [
          {
            foreignKeyName: "metric_entries_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "metric_entries_reviewed_by_fkey";
            columns: ["reviewed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      metric_entry_values: {
        Row: MetricEntryValue;
        Insert: { entry_id: string; metric_id: string; value: number };
        Update: { value?: number };
        Relationships: [
          {
            foreignKeyName: "metric_entry_values_entry_id_fkey";
            columns: ["entry_id"];
            isOneToOne: false;
            referencedRelation: "metric_entries";
            referencedColumns: ["id"];
          },
        ];
      };
      goals: {
        Row: Goal;
        Insert: Pick<Goal, "employee_id" | "metric_id" | "period" | "period_start" | "target_value">;
        Update: { status?: GoalStatus };
        Relationships: [];
      };
      scoring_rules: {
        Row: ScoringRule;
        Insert: Pick<ScoringRule, "metric_id" | "period" | "threshold" | "points"> & { is_active?: boolean };
        Update: Partial<Pick<ScoringRule, "period" | "threshold" | "points" | "is_active">>;
        Relationships: [];
      };
      app_settings: {
        Row: AppSettings;
        Insert: never;
        Update: Partial<
          Pick<
            AppSettings,
            "overall_leaderboard_enabled" | "points_start_date" | "streak_enabled" | "streak_min_days" | "streak_weeks" | "streak_points"
          >
        >;
        Relationships: [];
      };
      points_transactions: {
        Row: PointsTransaction;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      points_settlements: {
        Row: { id: string; employee_id: string; period: GoalPeriod; period_start: string; settled_at: string };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      rewards: {
        Row: Reward;
        Insert: Pick<Reward, "name" | "points_cost"> & Partial<Pick<Reward, "description" | "stock" | "is_active" | "sort_order">>;
        Update: Partial<Pick<Reward, "name" | "description" | "points_cost" | "stock" | "is_active" | "sort_order">>;
        Relationships: [];
      };
      reward_redemptions: {
        Row: RewardRedemption;
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "reward_redemptions_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      employee_registration_requests: {
        Row: EmployeeRegistrationRequest;
        Insert: {
          id?: string;
          full_name: string;
          email: string;
          employee_category: EmployeeCategorySlug;
          status?: RegistrationStatus;
          auth_user_id?: string | null;
          decided_by?: string | null;
          decided_at?: string | null;
          rejection_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          full_name?: string;
          email?: string;
          employee_category?: EmployeeCategorySlug;
          status?: RegistrationStatus;
          auth_user_id?: string | null;
          decided_by?: string | null;
          decided_at?: string | null;
          rejection_reason?: string | null;
        };
        Relationships: [];
      };
      hall_of_fame_awards: {
        Row: HallOfFameAward;
        Insert: {
          id?: string;
          employee_id: string;
          awarded_by: string;
          title: string;
          award_period: string;
          citation: string;
          bonus_points?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          employee_id?: string;
          title?: string;
          award_period?: string;
          citation?: string;
          bonus_points?: number;
          is_active?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "hall_of_fame_awards_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      goal_progress: { Row: GoalProgress; Relationships: [] };
      points_balances: { Row: PointsBalance; Relationships: [] };
    };
    Functions: {
      my_period_summary: {
        Args: { p_start: string; p_end: string };
        Returns: { metric_id: string; value: number | null; entries_counted: number }[];
      };
      metric_series: {
        Args: { p_bucket: GoalPeriod | null; p_start: string; p_end: string; p_employee?: string; p_category?: string };
        Returns: MetricSeriesRow[];
      };
      leaderboard: {
        Args: { p_period: GoalPeriod; p_day: string; p_category?: string };
        Returns: LeaderboardRow[];
      };
      sync_points: { Args: Record<string, never>; Returns: undefined };
      pending_points: { Args: { p_employee?: string }; Returns: PendingAward[] };
      adjust_points: { Args: { p_employee: string; p_amount: number; p_reason: string }; Returns: string };
      request_redemption: { Args: { p_reward: string }; Returns: string };
      cancel_redemption: { Args: { p_redemption: string }; Returns: undefined };
      decide_redemption: { Args: { p_redemption: string; p_decision: RedemptionDecision; p_note?: string }; Returns: undefined };
      submission_stats: {
        Args: { p_start: string; p_end: string; p_category?: string; p_employee?: string };
        Returns: SubmissionStatsRow[];
      };
    };
    Enums: {
      app_role: AppRole;
      metric_kind: MetricKind;
      metric_data_type: MetricDataType;
      metric_aggregation: MetricAggregation;
      entry_status: EntryStatus;
      goal_period: GoalPeriod;
      goal_status: GoalStatus;
      points_kind: PointsKind;
      redemption_status: RedemptionStatus;
    };
    CompositeTypes: { [_ in never]: never };
  };
};

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type EmployeeCategory = Database["public"]["Tables"]["employee_categories"]["Row"];
export type AuditLog = Database["public"]["Tables"]["audit_logs"]["Row"];
export type RegistrationStatus = "pending" | "approved" | "rejected";
export type EmployeeRegistrationRequest = {
  id: string;
  full_name: string;
  email: string;
  employee_category: EmployeeCategorySlug;
  status: RegistrationStatus;
  auth_user_id: string | null;
  decided_by: string | null;
  decided_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
};

// -----------------------------------------------------------------------------
// Phase 2: metrics, entries, goals, scoring
// -----------------------------------------------------------------------------
export type MetricKind = "input" | "calculated";
export type MetricDataType = "integer" | "decimal" | "currency" | "percentage";
export type MetricAggregation = "sum" | "average";
export type EntryStatus = "draft" | "pending" | "approved" | "rejected";
export type GoalPeriod = "daily" | "weekly" | "monthly";
export type GoalStatus = "active" | "cancelled";

export type MetricDefinition = {
  id: string;
  category: string;
  key: string;
  name: string;
  description: string | null;
  kind: MetricKind;
  data_type: MetricDataType;
  unit: string | null;
  aggregation: MetricAggregation;
  is_required: boolean;
  min_value: number | null;
  max_value: number | null;
  counts_as_unit: boolean;
  numerator_metric_id: string | null;
  numerator_is_unit_total: boolean;
  denominator_metric_id: string | null;
  default_target: number | null;
  is_goal_eligible: boolean;
  is_scoring_eligible: boolean;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type MetricEntry = {
  id: string;
  employee_id: string;
  entry_date: string;
  category: string;
  status: EntryStatus;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_note: string | null;
  /** status "rejected" + true: rejected (locked); + false: correction requested. */
  final_rejection: boolean;
  created_at: string;
  updated_at: string;
};

export type MetricEntryValue = {
  id: string;
  entry_id: string;
  metric_id: string;
  value: number | null;
  metric_name: string;
  metric_unit: string | null;
  metric_data_type: MetricDataType;
  created_at: string;
  updated_at: string;
};

export type Goal = {
  id: string;
  employee_id: string;
  metric_id: string;
  period: GoalPeriod;
  period_start: string;
  period_end: string;
  target_value: number;
  status: GoalStatus;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type GoalProgress = {
  goal_id: string;
  employee_id: string;
  metric_id: string;
  period: GoalPeriod;
  period_start: string;
  period_end: string;
  target_value: number;
  status: GoalStatus;
  current_value: number | null;
  entries_counted: number;
  percent_complete: number;
  remaining: number;
  /** Approved entries only (Phase 3). */
  verified_value: number | null;
  verified_percent: number;
};

export type ScoringRule = {
  id: string;
  metric_id: string;
  period: GoalPeriod;
  threshold: number;
  points: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

// -----------------------------------------------------------------------------
// Phase 3: verification, leaderboard, reporting
// -----------------------------------------------------------------------------
export type AppSettings = {
  id: string;
  singleton: boolean;
  overall_leaderboard_enabled: boolean;
  /** Phase 4: periods ending before this date never earn points. */
  points_start_date: string;
  streak_enabled: boolean;
  streak_min_days: number;
  streak_weeks: number;
  streak_points: number;
  created_at: string;
  updated_at: string;
};

/** Approved values per bucket (bucket = period start, or the range start when not bucketed). */
export type MetricSeriesRow = {
  bucket: string;
  employee_id: string;
  metric_id: string;
  value: number | null;
  entries_counted: number;
};

export type LeaderboardRow = {
  employee_id: string;
  full_name: string;
  category: string;
  points: number;
  max_points: number;
  goals_set: number;
  goals_achieved: number;
  approved_days: number;
  /** metric id → value. Only for admins and the employee's own row. */
  metric_values: Record<string, number | null> | null;
  /** metric id → average across the row's category. */
  team_average: Record<string, number | null> | null;
};

export type SubmissionStatsRow = { day: string; submitted: number; approved: number; pending: number; rejected: number };

// -----------------------------------------------------------------------------
// Phase 4: points ledger, rewards, redemptions
// -----------------------------------------------------------------------------
export type PointsKind = "performance" | "goal" | "streak" | "correction" | "adjustment" | "redemption" | "refund";
export type RedemptionStatus = "pending" | "approved" | "rejected" | "fulfilled" | "cancelled";
export type RedemptionDecision = "approve" | "reject" | "fulfil" | "refund";

export type PointsTransaction = {
  id: string;
  employee_id: string;
  kind: PointsKind;
  amount: number;
  description: string;
  award_key: string | null;
  period: GoalPeriod | null;
  period_start: string | null;
  metric_id: string | null;
  goal_id: string | null;
  redemption_id: string | null;
  idempotency_key: string;
  created_by: string | null;
  created_at: string;
};

export type PointsBalance = {
  employee_id: string;
  full_name: string;
  employee_category: string | null;
  is_active: boolean;
  /** Ledger total. */
  balance: number;
  lifetime_earned: number;
  redeemed: number;
  /** Reserved by pending redemption requests. */
  held: number;
  /** balance − held: what can be spent now. */
  available: number;
};

/** Points earned but not credited yet (open periods or entries awaiting review). */
export type PendingAward = {
  employee_id: string;
  period: GoalPeriod;
  period_start: string;
  award_key: string;
  kind: PointsKind;
  points: number;
  description: string;
};

export type Reward = {
  id: string;
  name: string;
  description: string | null;
  points_cost: number;
  /** null = unlimited. */
  stock: number | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type RewardRedemption = {
  id: string;
  employee_id: string;
  reward_id: string;
  reward_name: string;
  points_cost: number;
  status: RedemptionStatus;
  admin_note: string | null;
  requested_at: string;
  decided_at: string | null;
  decided_by: string | null;
  fulfilled_at: string | null;
  fulfilled_by: string | null;
  updated_at: string;
};

export type HallOfFameAward = {
  id: string;
  employee_id: string;
  awarded_by: string;
  title: string;
  award_period: string;
  citation: string;
  bonus_points: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  employee?: {
    id: string;
    full_name: string;
    email: string;
    employee_category: EmployeeCategorySlug | null;
  };
};
