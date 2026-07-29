/**
 * Hand-written types mirroring supabase/migrations/0001_init.sql.
 *
 * When Supabase credentials exist, replace this file with the output of
 * `supabase gen types typescript` and re-point imports at the generated
 * file — see docs/architecture.md.
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type GroupRole =
  | "owner"
  | "administrator"
  | "treasurer"
  | "loan_officer"
  | "auditor"
  | "member";

export type MembershipStatus = "active" | "suspended" | "removed";

export type GroupStatus = "active" | "suspended" | "archived";

export type ContributionFrequency =
  | "weekly"
  | "biweekly"
  | "monthly"
  | "quarterly"
  | "annually";

export type ContributionType = "fixed" | "flexible";

export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export type FinancialRecordStatus =
  | "pending"
  | "submitted"
  | "verified"
  | "reconciled"
  | "partly_paid"
  | "paid"
  | "overdue"
  | "approved"
  | "rejected"
  | "cancelled"
  | "reversed";

export type WithdrawalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "paid"
  | "reversed";

export type LoanApplicationStatus = "pending" | "submitted" | "approved" | "rejected" | "cancelled";

export type LoanStatus =
  | "approved"
  | "disbursed"
  | "partly_paid"
  | "paid"
  | "overdue"
  | "defaulted"
  | "cancelled"
  | "reversed";

export type RepaymentStatus = "submitted" | "verified" | "reconciled" | "cancelled" | "reversed";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";

export type ApprovalSubjectType =
  | "withdrawal_request"
  | "loan_application"
  | "governance_proposal"
  | "financial_correction"
  | "member_role_change";

export type VoteChoice = "for" | "against" | "abstain";

interface Table<Row, Insert, Update> {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
}

interface Fn<Args, Returns> {
  Args: Args;
  Returns: Returns;
}

export interface Database {
  public: {
    Views: Record<string, never>;
    Functions: {
      create_group_with_setup: Fn<
        {
          p_name: string;
          p_slug: string;
          p_description: string | null;
          p_country_code: string;
          p_currency_code: string;
          p_contribution_frequency: ContributionFrequency;
          p_contribution_type: ContributionType;
          p_fixed_amount_minor_units: number | null;
          p_financial_year_start_month: number;
          p_rules: string | null;
          p_invites: { email: string; role: GroupRole }[];
        },
        {
          group_id: string;
          slug: string;
          invite_links: { email: string; role: GroupRole; rawToken: string }[];
        }[]
      >;
      create_invitation: Fn<
        { p_group_id: string; p_email: string; p_role: GroupRole },
        { invitation_id: string; raw_token: string }[]
      >;
      revoke_invitation: Fn<{ p_invitation_id: string }, undefined>;
      get_invitation_preview: Fn<
        { p_token: string },
        {
          group_name: string;
          role: GroupRole;
          email: string;
          status: InvitationStatus;
          expires_at: string;
        }[]
      >;
      accept_invitation: Fn<
        { p_token: string },
        { group_id: string; role: GroupRole }[]
      >;
    };
    Tables: {
      profiles: Table<
        {
          id: string;
          full_name: string;
          email: string;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id: string;
          full_name: string;
          email: string;
          avatar_url?: string | null;
        },
        {
          full_name?: string;
          avatar_url?: string | null;
        }
      >;
      groups: Table<
        {
          id: string;
          name: string;
          slug: string;
          description: string | null;
          country_code: string;
          currency_code: string;
          contribution_frequency: ContributionFrequency;
          contribution_type: ContributionType;
          financial_year_start_month: number;
          rules: string | null;
          status: GroupStatus;
          created_by: string;
          created_at: string;
          updated_at: string;
        },
        {
          name: string;
          slug: string;
          description?: string | null;
          country_code: string;
          currency_code: string;
          contribution_frequency: ContributionFrequency;
          contribution_type: ContributionType;
          financial_year_start_month: number;
          rules?: string | null;
          status?: GroupStatus;
          created_by: string;
        },
        {
          name?: string;
          description?: string | null;
          rules?: string | null;
          status?: GroupStatus;
        }
      >;
      group_memberships: Table<
        {
          id: string;
          group_id: string;
          user_id: string;
          role: GroupRole;
          status: MembershipStatus;
          joined_at: string;
          updated_at: string;
        },
        {
          group_id: string;
          user_id: string;
          role: GroupRole;
          status?: MembershipStatus;
        },
        {
          role?: GroupRole;
          status?: MembershipStatus;
        }
      >;
      group_invitations: Table<
        {
          id: string;
          group_id: string;
          email: string;
          role: GroupRole;
          token_hash: string;
          status: InvitationStatus;
          invited_by: string;
          expires_at: string;
          accepted_at: string | null;
          accepted_by: string | null;
          created_at: string;
        },
        {
          group_id: string;
          email: string;
          role: GroupRole;
          token_hash: string;
          invited_by: string;
          expires_at: string;
          status?: InvitationStatus;
        },
        {
          status?: InvitationStatus;
          accepted_at?: string | null;
          accepted_by?: string | null;
        }
      >;
      contribution_plans: Table<
        {
          id: string;
          group_id: string;
          name: string;
          amount_minor_units: number | null;
          currency_code: string;
          frequency: ContributionFrequency;
          is_flexible: boolean;
          start_date: string;
          end_date: string | null;
          status: "active" | "inactive";
          created_by: string;
          created_at: string;
          updated_at: string;
        },
        {
          group_id: string;
          name: string;
          amount_minor_units?: number | null;
          currency_code: string;
          frequency: ContributionFrequency;
          is_flexible?: boolean;
          start_date: string;
          end_date?: string | null;
          status?: "active" | "inactive";
          created_by: string;
        },
        {
          name?: string;
          amount_minor_units?: number | null;
          status?: "active" | "inactive";
          end_date?: string | null;
        }
      >;
      contribution_records: Table<
        {
          id: string;
          group_id: string;
          contribution_plan_id: string | null;
          member_id: string;
          amount_minor_units: number;
          currency_code: string;
          period_start: string | null;
          period_end: string | null;
          status: FinancialRecordStatus;
          submitted_at: string | null;
          verified_by: string | null;
          verified_at: string | null;
          reconciled_by: string | null;
          reconciled_at: string | null;
          reversal_of: string | null;
          reversal_reason: string | null;
          notes: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        },
        {
          group_id: string;
          contribution_plan_id?: string | null;
          member_id: string;
          amount_minor_units: number;
          currency_code: string;
          period_start?: string | null;
          period_end?: string | null;
          status?: FinancialRecordStatus;
          notes?: string | null;
          created_by: string;
        },
        {
          status?: FinancialRecordStatus;
          verified_by?: string | null;
          verified_at?: string | null;
          reconciled_by?: string | null;
          reconciled_at?: string | null;
          notes?: string | null;
        }
      >;
      withdrawal_requests: Table<
        {
          id: string;
          group_id: string;
          requested_by: string;
          amount_minor_units: number;
          currency_code: string;
          reason: string;
          status: WithdrawalStatus;
          requires_dual_approval: boolean;
          approved_by_1: string | null;
          approved_at_1: string | null;
          approved_by_2: string | null;
          approved_at_2: string | null;
          paid_at: string | null;
          reversal_of: string | null;
          reversal_reason: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          group_id: string;
          requested_by: string;
          amount_minor_units: number;
          currency_code: string;
          reason: string;
          requires_dual_approval?: boolean;
        },
        {
          status?: WithdrawalStatus;
          approved_by_1?: string | null;
          approved_at_1?: string | null;
          approved_by_2?: string | null;
          approved_at_2?: string | null;
          paid_at?: string | null;
        }
      >;
      loan_products: Table<
        {
          id: string;
          group_id: string;
          name: string;
          description: string | null;
          interest_rate_bps: number;
          max_amount_minor_units: number | null;
          max_term_months: number | null;
          status: "active" | "inactive";
          created_by: string;
          created_at: string;
          updated_at: string;
        },
        {
          group_id: string;
          name: string;
          description?: string | null;
          interest_rate_bps?: number;
          max_amount_minor_units?: number | null;
          max_term_months?: number | null;
          status?: "active" | "inactive";
          created_by: string;
        },
        {
          name?: string;
          description?: string | null;
          status?: "active" | "inactive";
        }
      >;
      loan_applications: Table<
        {
          id: string;
          group_id: string;
          loan_product_id: string | null;
          applicant_id: string;
          amount_requested_minor_units: number;
          currency_code: string;
          term_months: number;
          purpose: string | null;
          status: LoanApplicationStatus;
          reviewed_by: string | null;
          reviewed_at: string | null;
          decision_notes: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          group_id: string;
          loan_product_id?: string | null;
          applicant_id: string;
          amount_requested_minor_units: number;
          currency_code: string;
          term_months: number;
          purpose?: string | null;
        },
        {
          status?: LoanApplicationStatus;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          decision_notes?: string | null;
        }
      >;
      loans: Table<
        {
          id: string;
          group_id: string;
          loan_application_id: string | null;
          borrower_id: string;
          principal_minor_units: number;
          currency_code: string;
          interest_rate_bps: number;
          term_months: number;
          status: LoanStatus;
          disbursed_at: string | null;
          due_date: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          group_id: string;
          loan_application_id?: string | null;
          borrower_id: string;
          principal_minor_units: number;
          currency_code: string;
          interest_rate_bps?: number;
          term_months: number;
        },
        {
          status?: LoanStatus;
          disbursed_at?: string | null;
          due_date?: string | null;
        }
      >;
      repayments: Table<
        {
          id: string;
          group_id: string;
          loan_id: string;
          amount_minor_units: number;
          currency_code: string;
          status: RepaymentStatus;
          paid_at: string | null;
          verified_by: string | null;
          verified_at: string | null;
          reconciled_by: string | null;
          reconciled_at: string | null;
          reversal_of: string | null;
          reversal_reason: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        },
        {
          group_id: string;
          loan_id: string;
          amount_minor_units: number;
          currency_code: string;
          created_by: string;
        },
        {
          status?: RepaymentStatus;
          verified_by?: string | null;
          verified_at?: string | null;
          reconciled_by?: string | null;
          reconciled_at?: string | null;
        }
      >;
      approval_requests: Table<
        {
          id: string;
          group_id: string;
          subject_type: ApprovalSubjectType;
          subject_id: string;
          requested_by: string;
          status: ApprovalStatus;
          required_approvals: number;
          created_at: string;
          updated_at: string;
        },
        {
          group_id: string;
          subject_type: ApprovalSubjectType;
          subject_id: string;
          requested_by: string;
          required_approvals?: number;
        },
        {
          status?: ApprovalStatus;
        }
      >;
      approval_decisions: Table<
        {
          id: string;
          approval_request_id: string;
          approver_id: string;
          decision: "approved" | "rejected";
          notes: string | null;
          decided_at: string;
        },
        {
          approval_request_id: string;
          approver_id: string;
          decision: "approved" | "rejected";
          notes?: string | null;
        },
        Record<string, never>
      >;
      governance_proposals: Table<
        {
          id: string;
          group_id: string;
          title: string;
          description: string | null;
          proposed_by: string;
          status: ApprovalStatus;
          voting_opens_at: string | null;
          voting_closes_at: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          group_id: string;
          title: string;
          description?: string | null;
          proposed_by: string;
          voting_opens_at?: string | null;
          voting_closes_at?: string | null;
        },
        {
          status?: ApprovalStatus;
          voting_opens_at?: string | null;
          voting_closes_at?: string | null;
        }
      >;
      votes: Table<
        {
          id: string;
          proposal_id: string;
          group_id: string;
          voter_id: string;
          choice: VoteChoice;
          cast_at: string;
        },
        {
          proposal_id: string;
          group_id: string;
          voter_id: string;
          choice: VoteChoice;
        },
        Record<string, never>
      >;
      documents: Table<
        {
          id: string;
          group_id: string;
          title: string;
          description: string | null;
          storage_path: string;
          related_type: string | null;
          related_id: string | null;
          uploaded_by: string;
          created_at: string;
        },
        {
          group_id: string;
          title: string;
          description?: string | null;
          storage_path: string;
          related_type?: string | null;
          related_id?: string | null;
          uploaded_by: string;
        },
        Record<string, never>
      >;
      notifications: Table<
        {
          id: string;
          group_id: string | null;
          recipient_id: string;
          type: string;
          title: string;
          body: string | null;
          is_read: boolean;
          related_type: string | null;
          related_id: string | null;
          created_at: string;
        },
        {
          group_id?: string | null;
          recipient_id: string;
          type: string;
          title: string;
          body?: string | null;
          related_type?: string | null;
          related_id?: string | null;
        },
        {
          is_read?: boolean;
        }
      >;
      audit_logs: Table<
        {
          id: string;
          group_id: string | null;
          actor_id: string | null;
          action: string;
          entity_type: string;
          entity_id: string | null;
          metadata: Json;
          created_at: string;
        },
        {
          group_id?: string | null;
          actor_id?: string | null;
          action: string;
          entity_type: string;
          entity_id?: string | null;
          metadata?: Json;
        },
        Record<string, never>
      >;
    };
  };
}
