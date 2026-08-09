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

export type GroupStatus = "pending_review" | "active" | "rejected" | "suspended" | "archived";

export type OrganiserApplicationStatus = "pending" | "approved" | "rejected" | "suspended";

export type ContributionFrequency =
  | "weekly"
  | "biweekly"
  | "monthly"
  | "quarterly"
  | "annually";

export type ContributionType = "fixed" | "flexible";

export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export type ContributionRecordStatus =
  | "pending_verification"
  | "verified"
  | "reconciled"
  | "rejected"
  | "reversed";

export type PaymentMethod = "cash" | "bank_transfer" | "mobile_money" | "cheque" | "other";

export type WithdrawalStatus =
  | "draft"
  | "submitted"
  | "under_review"
  | "approved"
  | "rejected"
  | "cancelled"
  | "awaiting_payment"
  | "paid_externally"
  | "reversed";

export type LoanApplicationStatus =
  | "draft"
  | "submitted"
  | "under_review"
  | "approved"
  | "rejected"
  | "cancelled";

/** Deliberately does not include overdue/fully_repaid/partly_paid — those
 * are computed server-side (src/lib/loans.ts) from the schedule and
 * verified repayments, never stored. See docs/architecture.md. */
export type LoanStatus = "awaiting_disbursement" | "active" | "defaulted" | "cancelled";

export type RepaymentStatus =
  | "pending_verification"
  | "verified"
  | "reconciled"
  | "rejected"
  | "reversed";

export type InterestType = "one_time_flat";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";

export type ApprovalSubjectType =
  | "withdrawal_request"
  | "loan_application"
  | "governance_proposal"
  | "financial_correction"
  | "member_role_change";

export type VoteChoice = "for" | "against" | "abstain";

export type GovernanceProposalStatus = "open" | "cancelled";

export type OwnershipTransferStatus = "pending" | "accepted" | "declined" | "cancelled" | "expired";

export type NotificationEmailStatus = "not_required" | "pending" | "sending" | "sent" | "failed";

export type NotificationCategory =
  | "invitation"
  | "contribution"
  | "loan"
  | "repayment"
  | "withdrawal"
  | "governance"
  | "membership"
  | "ownership_transfer";

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
          group_name: string | null;
          role: GroupRole | null;
          email: string | null;
          can_accept: boolean;
          message: string | null;
        }[]
      >;
      accept_invitation: Fn<
        { p_token: string },
        { group_id: string; role: GroupRole }[]
      >;
      upsert_contribution_plan: Fn<
        {
          p_group_id: string;
          p_plan_id: string | null;
          p_is_flexible: boolean;
          p_amount_minor_units: number | null;
          p_minimum_amount_minor_units: number | null;
          p_frequency: ContributionFrequency;
          p_start_date: string;
        },
        { plan_id: string }[]
      >;
      record_contribution: Fn<
        {
          p_group_id: string;
          p_member_id: string;
          p_contribution_plan_id: string | null;
          p_amount_minor_units: number;
          p_period_start: string;
          p_period_end: string;
          p_received_at: string;
          p_payment_method: PaymentMethod;
          p_payment_reference: string | null;
          p_notes: string | null;
        },
        { record_id: string }[]
      >;
      edit_contribution: Fn<
        {
          p_record_id: string;
          p_amount_minor_units: number;
          p_period_start: string;
          p_period_end: string;
          p_received_at: string;
          p_payment_method: PaymentMethod;
          p_payment_reference: string | null;
          p_notes: string | null;
        },
        undefined
      >;
      verify_contribution: Fn<{ p_record_id: string }, undefined>;
      reconcile_contribution: Fn<{ p_record_id: string }, undefined>;
      record_backdated_contribution: Fn<
        {
          p_group_id: string;
          p_member_id: string;
          p_amount_minor_units: number;
          p_received_at: string;
          p_note: string | null;
          p_confirm_implausible_date: boolean;
        },
        { record_id: string; is_backdated: boolean }[]
      >;
      bulk_import_contributions: Fn<
        {
          p_group_id: string;
          p_rows: {
            member_identifier: string;
            amount_minor_units: number;
            received_at: string;
            note: string | null;
          }[];
          p_confirm_implausible_dates: boolean;
          p_dry_run: boolean;
        },
        {
          row_index: number;
          success: boolean;
          record_id: string | null;
          member_identifier: string;
          is_backdated: boolean | null;
          error_message: string | null;
        }[]
      >;
      confirm_backdated_contribution: Fn<{ p_record_id: string }, undefined>;
      reject_contribution: Fn<{ p_record_id: string; p_reason: string }, undefined>;
      reverse_contribution: Fn<
        {
          p_record_id: string;
          p_reason: string;
          p_replacement: {
            amount_minor_units?: number;
            period_start?: string;
            period_end?: string;
            received_at?: string;
            payment_method?: PaymentMethod;
            payment_reference?: string;
            notes?: string;
          } | null;
        },
        { record_id: string; replacement_id: string | null }[]
      >;
      upsert_loan_product: Fn<
        {
          p_group_id: string;
          p_product_id: string | null;
          p_enabled: boolean;
          p_max_loan_bps_of_contributions: number;
          p_max_amount_minor_units: number | null;
          p_interest_type: InterestType;
          p_interest_rate_bps: number;
          p_min_term_months: number | null;
          p_max_term_months: number | null;
          p_repayment_frequency: ContributionFrequency;
          p_allow_overdue_members: boolean;
          p_grace_period_days: number;
        },
        { product_id: string }[]
      >;
      apply_for_loan: Fn<
        {
          p_group_id: string;
          p_amount_minor_units: number;
          p_term_months: number;
          p_purpose: string | null;
        },
        { application_id: string }[]
      >;
      mark_loan_under_review: Fn<{ p_application_id: string }, undefined>;
      decide_loan_application: Fn<
        {
          p_application_id: string;
          p_decision: "approved" | "rejected";
          p_approved_amount_minor_units: number | null;
          p_approved_term_months: number | null;
          p_approved_interest_rate_bps: number | null;
          p_approved_repayment_frequency: ContributionFrequency | null;
          p_notes: string | null;
        },
        { application_id: string; loan_id: string | null }[]
      >;
      cancel_loan_application: Fn<{ p_application_id: string }, undefined>;
      record_disbursement: Fn<
        {
          p_loan_id: string;
          p_disbursement_date: string;
          p_disbursement_reference: string | null;
          p_disbursement_note: string | null;
        },
        undefined
      >;
      mark_loan_defaulted: Fn<{ p_loan_id: string; p_reason: string }, undefined>;
      record_repayment: Fn<
        {
          p_loan_id: string;
          p_amount_minor_units: number;
          p_received_at: string;
          p_payment_method: PaymentMethod;
          p_payment_reference: string | null;
          p_notes: string | null;
        },
        { repayment_id: string }[]
      >;
      verify_repayment: Fn<{ p_repayment_id: string }, undefined>;
      reconcile_repayment: Fn<{ p_repayment_id: string }, undefined>;
      reject_repayment: Fn<{ p_repayment_id: string; p_reason: string }, undefined>;
      reverse_repayment: Fn<
        {
          p_repayment_id: string;
          p_reason: string;
          p_replacement: {
            amount_minor_units?: number;
            received_at?: string;
            payment_method?: PaymentMethod;
            payment_reference?: string;
            notes?: string;
          } | null;
        },
        { repayment_id: string; replacement_id: string | null }[]
      >;
      upsert_withdrawal_policy: Fn<
        {
          p_group_id: string;
          p_policy_id: string | null;
          p_enabled: boolean;
          p_min_amount_minor_units: number | null;
          p_max_amount_minor_units: number | null;
          p_notice_period_days: number;
          p_allow_partial: boolean;
          p_reviewer_roles: GroupRole[];
          p_required_approvals: number;
          p_allow_overdue_members: boolean;
          p_block_members_with_active_loans: boolean;
          p_large_withdrawal_threshold_minor_units: number | null;
        },
        { policy_id: string }[]
      >;
      request_withdrawal: Fn<
        {
          p_group_id: string;
          p_amount_minor_units: number;
          p_reason: string;
          p_linked_proposal_id: string | null;
        },
        { request_id: string }[]
      >;
      cancel_withdrawal_request: Fn<{ p_request_id: string }, undefined>;
      review_withdrawal_request: Fn<{ p_request_id: string }, undefined>;
      decide_withdrawal_request: Fn<
        { p_request_id: string; p_decision: "approved" | "rejected"; p_notes: string | null },
        { request_id: string; new_status: string }[]
      >;
      confirm_withdrawal_payment: Fn<
        {
          p_request_id: string;
          p_paid_amount_minor_units: number;
          p_bank_reference: string;
          p_paid_at: string;
          p_note: string | null;
        },
        undefined
      >;
      reverse_withdrawal_payment: Fn<{ p_request_id: string; p_reason: string }, undefined>;
      create_governance_proposal: Fn<
        {
          p_group_id: string;
          p_title: string;
          p_description: string | null;
          p_category: string | null;
          p_voting_opens_at: string;
          p_voting_closes_at: string;
          p_quorum_percent: number | null;
          p_approval_threshold_percent: number;
        },
        { proposal_id: string }[]
      >;
      cancel_governance_proposal: Fn<{ p_proposal_id: string; p_reason: string }, undefined>;
      cast_vote: Fn<{ p_proposal_id: string; p_choice: VoteChoice }, undefined>;
      change_member_role: Fn<
        { p_group_id: string; p_member_id: string; p_new_role: GroupRole; p_reason: string },
        undefined
      >;
      suspend_member: Fn<{ p_group_id: string; p_member_id: string; p_reason: string }, undefined>;
      reactivate_member: Fn<
        { p_group_id: string; p_member_id: string; p_reason: string | null },
        undefined
      >;
      remove_member: Fn<{ p_group_id: string; p_member_id: string; p_reason: string }, undefined>;
      leave_group: Fn<{ p_group_id: string; p_reason: string | null }, undefined>;
      initiate_ownership_transfer: Fn<
        { p_group_id: string; p_to_user_id: string; p_reason: string },
        { transfer_id: string }[]
      >;
      accept_ownership_transfer: Fn<{ p_transfer_id: string }, undefined>;
      decline_ownership_transfer: Fn<{ p_transfer_id: string; p_reason: string | null }, undefined>;
      cancel_ownership_transfer: Fn<{ p_transfer_id: string; p_reason: string }, undefined>;
      create_notification: Fn<
        {
          p_recipient_id: string;
          p_group_id: string | null;
          p_category: NotificationCategory;
          p_type: string;
          p_title: string;
          p_body: string | null;
          p_related_type: string | null;
          p_related_id: string | null;
          p_dedupe_key: string;
        },
        string | null
      >;
      claim_pending_notification_emails: Fn<
        { p_limit: number },
        { notification_id: string; recipient_email: string; subject: string; action_path: string }[]
      >;
      mark_notification_email_result: Fn<
        { p_notification_id: string; p_status: "sent" | "failed"; p_error: string | null },
        undefined
      >;
      send_overdue_contribution_reminders: Fn<{ p_today: string }, number>;
      send_overdue_repayment_reminders: Fn<{ p_today: string }, number>;
      send_governance_deadline_reminders: Fn<{ p_now: string }, number>;
      expire_stale_invitations: Fn<{ p_now: string }, number>;
      expire_stale_ownership_transfers: Fn<{ p_now: string }, number>;
      check_rate_limit: Fn<{ p_key: string; p_window_seconds: number; p_max: number }, boolean>;
      publish_group_constitution: Fn<
        { p_group_id: string; p_storage_path: string; p_title: string; p_note: string | null },
        { id: string; version: number }[]
      >;
      acknowledge_group_constitution: Fn<{ p_constitution_id: string }, undefined>;
      is_platform_admin: Fn<Record<string, never>, boolean>;
      is_group_active: Fn<{ p_group_id: string }, boolean>;
      is_organiser_approved: Fn<{ p_user_id: string }, boolean>;
      get_platform_config_int: Fn<{ p_key: string; p_default: number }, number>;
      set_platform_config_int: Fn<{ p_key: string; p_value: number; p_reason: string | null }, undefined>;
      apply_for_organiser_status: Fn<{ p_note: string | null }, string>;
      decide_organiser_application: Fn<
        { p_user_id: string; p_decision: "approved" | "rejected"; p_reason: string | null },
        undefined
      >;
      suspend_organiser: Fn<{ p_user_id: string; p_reason: string }, undefined>;
      reactivate_organiser: Fn<{ p_user_id: string; p_reason: string | null }, undefined>;
      decide_group_review: Fn<
        { p_group_id: string; p_decision: "active" | "rejected"; p_reason: string | null },
        undefined
      >;
      suspend_group: Fn<{ p_group_id: string; p_reason: string }, undefined>;
      reactivate_group: Fn<{ p_group_id: string; p_reason: string | null }, undefined>;
      archive_group: Fn<{ p_group_id: string; p_reason: string | null }, undefined>;
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
      ownership_transfers: Table<
        {
          id: string;
          group_id: string;
          from_user_id: string;
          to_user_id: string;
          reason: string;
          status: OwnershipTransferStatus;
          created_at: string;
          expires_at: string;
          responded_at: string | null;
          responded_by: string | null;
          cancelled_reason: string | null;
        },
        {
          group_id: string;
          from_user_id: string;
          to_user_id: string;
          reason: string;
        },
        {
          status?: OwnershipTransferStatus;
          responded_at?: string | null;
          responded_by?: string | null;
          cancelled_reason?: string | null;
        }
      >;
      contribution_plans: Table<
        {
          id: string;
          group_id: string;
          name: string;
          amount_minor_units: number | null;
          minimum_amount_minor_units: number | null;
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
          minimum_amount_minor_units?: number | null;
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
          minimum_amount_minor_units?: number | null;
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
          received_at: string;
          payment_method: PaymentMethod | null;
          payment_reference: string | null;
          status: ContributionRecordStatus;
          submitted_at: string | null;
          verified_by: string | null;
          verified_at: string | null;
          reconciled_by: string | null;
          reconciled_at: string | null;
          rejected_by: string | null;
          rejected_at: string | null;
          rejection_reason: string | null;
          reversed_by: string | null;
          reversed_at: string | null;
          reversal_of: string | null;
          reversal_reason: string | null;
          notes: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
          is_backdated: boolean;
          confirmed_by: string | null;
          confirmed_at: string | null;
        },
        {
          group_id: string;
          contribution_plan_id?: string | null;
          member_id: string;
          amount_minor_units: number;
          currency_code: string;
          period_start?: string | null;
          period_end?: string | null;
          received_at?: string;
          payment_method?: PaymentMethod | null;
          payment_reference?: string | null;
          status?: ContributionRecordStatus;
          notes?: string | null;
          created_by: string;
          is_backdated?: boolean;
        },
        {
          status?: ContributionRecordStatus;
          verified_by?: string | null;
          verified_at?: string | null;
          reconciled_by?: string | null;
          reconciled_at?: string | null;
          notes?: string | null;
          confirmed_by?: string | null;
          confirmed_at?: string | null;
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
          reviewed_by: string | null;
          reviewed_at: string | null;
          decision_notes: string | null;
          paid_amount_minor_units: number | null;
          payment_date: string | null;
          paid_bank_reference: string | null;
          paid_by: string | null;
          payment_note: string | null;
          paid_at: string | null;
          linked_proposal_id: string | null;
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
          linked_proposal_id?: string | null;
        },
        {
          status?: WithdrawalStatus;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          decision_notes?: string | null;
          paid_amount_minor_units?: number | null;
          payment_date?: string | null;
          paid_bank_reference?: string | null;
          paid_by?: string | null;
          payment_note?: string | null;
          paid_at?: string | null;
        }
      >;
      withdrawal_policies: Table<
        {
          id: string;
          group_id: string;
          status: "active" | "inactive";
          min_amount_minor_units: number | null;
          max_amount_minor_units: number | null;
          notice_period_days: number;
          allow_partial: boolean;
          reviewer_roles: GroupRole[];
          required_approvals: number;
          allow_overdue_members: boolean;
          block_members_with_active_loans: boolean;
          large_withdrawal_threshold_minor_units: number | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        },
        {
          group_id: string;
          status?: "active" | "inactive";
          min_amount_minor_units?: number | null;
          max_amount_minor_units?: number | null;
          notice_period_days?: number;
          allow_partial?: boolean;
          reviewer_roles?: GroupRole[];
          required_approvals?: number;
          allow_overdue_members?: boolean;
          block_members_with_active_loans?: boolean;
          large_withdrawal_threshold_minor_units?: number | null;
          created_by: string;
        },
        {
          status?: "active" | "inactive";
          min_amount_minor_units?: number | null;
          max_amount_minor_units?: number | null;
          notice_period_days?: number;
          allow_partial?: boolean;
          reviewer_roles?: GroupRole[];
          required_approvals?: number;
          allow_overdue_members?: boolean;
          block_members_with_active_loans?: boolean;
          large_withdrawal_threshold_minor_units?: number | null;
        }
      >;
      loan_products: Table<
        {
          id: string;
          group_id: string;
          name: string;
          description: string | null;
          interest_type: InterestType;
          interest_rate_bps: number;
          max_amount_minor_units: number | null;
          max_loan_bps_of_contributions: number;
          min_term_months: number | null;
          max_term_months: number | null;
          repayment_frequency: ContributionFrequency;
          allow_overdue_members: boolean;
          grace_period_days: number;
          status: "active" | "inactive";
          created_by: string;
          created_at: string;
          updated_at: string;
        },
        {
          group_id: string;
          name: string;
          description?: string | null;
          interest_type?: InterestType;
          interest_rate_bps?: number;
          max_amount_minor_units?: number | null;
          max_loan_bps_of_contributions?: number;
          min_term_months?: number | null;
          max_term_months?: number | null;
          repayment_frequency?: ContributionFrequency;
          allow_overdue_members?: boolean;
          grace_period_days?: number;
          status?: "active" | "inactive";
          created_by: string;
        },
        {
          name?: string;
          description?: string | null;
          interest_rate_bps?: number;
          max_amount_minor_units?: number | null;
          max_loan_bps_of_contributions?: number;
          min_term_months?: number | null;
          max_term_months?: number | null;
          repayment_frequency?: ContributionFrequency;
          allow_overdue_members?: boolean;
          grace_period_days?: number;
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
          approved_amount_minor_units: number | null;
          approved_term_months: number | null;
          approved_interest_rate_bps: number | null;
          approved_repayment_frequency: ContributionFrequency | null;
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
          status?: LoanApplicationStatus;
        },
        {
          status?: LoanApplicationStatus;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          decision_notes?: string | null;
          approved_amount_minor_units?: number | null;
          approved_term_months?: number | null;
          approved_interest_rate_bps?: number | null;
          approved_repayment_frequency?: ContributionFrequency | null;
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
          interest_amount_minor_units: number;
          total_repayable_minor_units: number;
          term_months: number;
          repayment_frequency: ContributionFrequency;
          status: LoanStatus;
          disbursed_by: string | null;
          disbursed_at: string | null;
          disbursement_date: string | null;
          disbursement_reference: string | null;
          disbursement_note: string | null;
          defaulted_by: string | null;
          defaulted_at: string | null;
          default_reason: string | null;
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
          interest_amount_minor_units: number;
          total_repayable_minor_units: number;
          term_months: number;
          repayment_frequency: ContributionFrequency;
          status?: LoanStatus;
        },
        {
          status?: LoanStatus;
          disbursed_by?: string | null;
          disbursed_at?: string | null;
          disbursement_date?: string | null;
          disbursement_reference?: string | null;
          disbursement_note?: string | null;
          defaulted_by?: string | null;
          defaulted_at?: string | null;
          default_reason?: string | null;
        }
      >;
      repayments: Table<
        {
          id: string;
          group_id: string;
          loan_id: string;
          member_id: string;
          amount_minor_units: number;
          currency_code: string;
          principal_portion_minor_units: number;
          interest_portion_minor_units: number;
          payment_method: PaymentMethod | null;
          payment_reference: string | null;
          notes: string | null;
          received_at: string;
          status: RepaymentStatus;
          paid_at: string | null;
          verified_by: string | null;
          verified_at: string | null;
          reconciled_by: string | null;
          reconciled_at: string | null;
          rejected_by: string | null;
          rejected_at: string | null;
          rejection_reason: string | null;
          reversed_by: string | null;
          reversed_at: string | null;
          reversal_of: string | null;
          reversal_reason: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        },
        {
          group_id: string;
          loan_id: string;
          member_id: string;
          amount_minor_units: number;
          currency_code: string;
          principal_portion_minor_units: number;
          interest_portion_minor_units: number;
          payment_method?: PaymentMethod | null;
          payment_reference?: string | null;
          notes?: string | null;
          received_at?: string;
          status?: RepaymentStatus;
          created_by: string;
        },
        {
          status?: RepaymentStatus;
          verified_by?: string | null;
          verified_at?: string | null;
          reconciled_by?: string | null;
          reconciled_at?: string | null;
          rejected_by?: string | null;
          rejected_at?: string | null;
          rejection_reason?: string | null;
          reversed_by?: string | null;
          reversed_at?: string | null;
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
          category: string | null;
          proposed_by: string;
          status: GovernanceProposalStatus;
          voting_opens_at: string;
          voting_closes_at: string;
          quorum_percent: number | null;
          approval_threshold_percent: number;
          cancelled_by: string | null;
          cancelled_at: string | null;
          cancelled_reason: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          group_id: string;
          title: string;
          description?: string | null;
          category?: string | null;
          proposed_by: string;
          voting_opens_at: string;
          voting_closes_at: string;
          quorum_percent?: number | null;
          approval_threshold_percent?: number;
        },
        {
          status?: GovernanceProposalStatus;
          cancelled_by?: string | null;
          cancelled_at?: string | null;
          cancelled_reason?: string | null;
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
          category: NotificationCategory | null;
          type: string;
          title: string;
          body: string | null;
          is_read: boolean;
          related_type: string | null;
          related_id: string | null;
          dedupe_key: string | null;
          email_status: NotificationEmailStatus;
          email_attempted_at: string | null;
          email_error: string | null;
          created_at: string;
        },
        {
          group_id?: string | null;
          recipient_id: string;
          category?: NotificationCategory | null;
          type: string;
          title: string;
          body?: string | null;
          related_type?: string | null;
          related_id?: string | null;
          dedupe_key?: string | null;
          email_status?: NotificationEmailStatus;
        },
        {
          is_read?: boolean;
        }
      >;
      notification_preferences: Table<
        {
          user_id: string;
          category: string;
          email_enabled: boolean;
          created_at: string;
          updated_at: string;
        },
        {
          user_id: string;
          category: string;
          email_enabled?: boolean;
        },
        {
          email_enabled?: boolean;
        }
      >;
      member_profiles: Table<
        {
          id: string;
          user_id: string;
          group_id: string;
          first_name: string;
          middle_name: string | null;
          last_name: string;
          date_of_birth: string;
          gender: string | null;
          phone: string;
          email: string;
          address_line1: string;
          address_line2: string | null;
          city: string;
          postcode: string;
          country: string;
          next_of_kin_full_name: string;
          next_of_kin_relationship: string;
          next_of_kin_phone: string;
          next_of_kin_email: string | null;
          consent_given_at: string;
          created_at: string;
          updated_at: string;
        },
        {
          user_id: string;
          group_id: string;
          first_name: string;
          middle_name?: string | null;
          last_name: string;
          date_of_birth: string;
          gender?: string | null;
          phone: string;
          email: string;
          address_line1: string;
          address_line2?: string | null;
          city: string;
          postcode: string;
          country?: string;
          next_of_kin_full_name: string;
          next_of_kin_relationship: string;
          next_of_kin_phone: string;
          next_of_kin_email?: string | null;
          consent_given_at: string;
        },
        {
          first_name?: string;
          middle_name?: string | null;
          last_name?: string;
          date_of_birth?: string;
          gender?: string | null;
          phone?: string;
          email?: string;
          address_line1?: string;
          address_line2?: string | null;
          city?: string;
          postcode?: string;
          country?: string;
          next_of_kin_full_name?: string;
          next_of_kin_relationship?: string;
          next_of_kin_phone?: string;
          next_of_kin_email?: string | null;
        }
      >;
      group_constitutions: Table<
        {
          id: string;
          group_id: string;
          version: number;
          storage_path: string;
          title: string;
          note: string | null;
          published_by: string;
          published_at: string;
        },
        {
          group_id: string;
          version: number;
          storage_path: string;
          title: string;
          note?: string | null;
          published_by: string;
        },
        Record<string, never>
      >;
      constitution_acknowledgements: Table<
        {
          id: string;
          user_id: string;
          group_id: string;
          constitution_id: string;
          acknowledged_at: string;
        },
        {
          user_id: string;
          group_id: string;
          constitution_id: string;
        },
        Record<string, never>
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
      organiser_applications: Table<
        {
          id: string;
          user_id: string;
          status: OrganiserApplicationStatus;
          application_note: string | null;
          submitted_at: string;
          decided_by: string | null;
          decided_at: string | null;
          decision_reason: string | null;
          created_at: string;
        },
        {
          user_id: string;
          status?: OrganiserApplicationStatus;
          application_note?: string | null;
        },
        Record<string, never>
      >;
      platform_admins: Table<
        {
          user_id: string;
          granted_by: string | null;
          granted_at: string;
          notes: string | null;
        },
        { user_id: string; granted_by?: string | null; notes?: string | null },
        Record<string, never>
      >;
      platform_config: Table<
        {
          key: string;
          value: Json;
          updated_by: string | null;
          updated_at: string;
        },
        { key: string; value: Json; updated_by?: string | null },
        { value?: Json; updated_by?: string | null }
      >;
    };
  };
}
