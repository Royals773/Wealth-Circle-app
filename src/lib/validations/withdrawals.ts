import { z } from "zod";
import { reasonSchema } from "@/lib/validations/contributions";

export { reasonSchema };

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date");
const todayISO = () => new Date().toISOString().slice(0, 10);

/** Matches the withdrawal_policy_reviewer_roles_valid check constraint
 * in 0011_phase6_withdrawals_governance.sql — a plain 'member' can
 * never be a reviewer of their own or another member's request. */
export const REVIEWER_ELIGIBLE_ROLES = ["owner", "administrator", "treasurer", "loan_officer", "auditor"] as const;

export const withdrawalPolicyFormSchema = z
  .object({
    enabled: z.enum(["true", "false"]).transform((value) => value === "true"),
    minAmountMajorUnits: z.coerce.number().positive().optional(),
    maxAmountMajorUnits: z.coerce.number().positive().optional(),
    noticePeriodDays: z.coerce.number().int().min(0).optional(),
    allowPartial: z.enum(["true", "false"]).transform((value) => value === "true"),
    reviewerRoles: z.array(z.enum(REVIEWER_ELIGIBLE_ROLES)).min(1, "Choose at least one reviewer role"),
    requiredApprovals: z.coerce.number().int().min(1, "At least one approval is required"),
    allowOverdueMembers: z.enum(["true", "false"]).transform((value) => value === "true"),
    blockMembersWithActiveLoans: z.enum(["true", "false"]).transform((value) => value === "true"),
    largeWithdrawalThresholdMajorUnits: z.coerce.number().positive().optional(),
  })
  .refine(
    (data) => data.minAmountMajorUnits === undefined || data.maxAmountMajorUnits === undefined || data.minAmountMajorUnits <= data.maxAmountMajorUnits,
    { message: "The minimum can't be greater than the maximum", path: ["minAmountMajorUnits"] },
  );

export type WithdrawalPolicyFormInput = z.infer<typeof withdrawalPolicyFormSchema>;

export const requestWithdrawalSchema = z.object({
  amountMajorUnits: z.coerce.number().positive("Enter an amount greater than zero"),
  reason: z.string().trim().min(1, "A reason is required").max(500, "Keep the reason under 500 characters"),
  linkedProposalId: z.string().uuid().optional(),
});

export type RequestWithdrawalInput = z.infer<typeof requestWithdrawalSchema>;

export const decideWithdrawalSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  notes: z.string().max(1000, "Keep notes under 1000 characters").optional(),
});

export type DecideWithdrawalInput = z.infer<typeof decideWithdrawalSchema>;

export const confirmWithdrawalPaymentSchema = z.object({
  bankReference: z.string().trim().min(1, "A bank reference is required").max(120, "Keep the reference under 120 characters"),
  paidAt: isoDateSchema.refine((value) => value <= todayISO(), "The payment date can't be in the future"),
  note: z.string().max(1000, "Keep the note under 1000 characters").optional(),
});

export type ConfirmWithdrawalPaymentInput = z.infer<typeof confirmWithdrawalPaymentSchema>;
