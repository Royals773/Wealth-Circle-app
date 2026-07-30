import { z } from "zod";
import { CONTRIBUTION_FREQUENCIES } from "@/lib/validations/group";
import { PAYMENT_METHODS, reasonSchema } from "@/lib/validations/contributions";

export { reasonSchema };

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date");
const todayISO = () => new Date().toISOString().slice(0, 10);

export const loanPolicyFormSchema = z
  .object({
    enabled: z.enum(["true", "false"]).transform((value) => value === "true"),
    maxLoanPercent: z.coerce.number().positive("Enter a percentage greater than zero"),
    maxAmountMajorUnits: z.coerce.number().positive().optional(),
    interestRatePercent: z.coerce.number().min(0, "Enter a rate of zero or more"),
    minTermMonths: z.coerce.number().int().positive().optional(),
    maxTermMonths: z.coerce.number().int().positive(),
    repaymentFrequency: z.enum(CONTRIBUTION_FREQUENCIES),
    allowOverdueMembers: z.enum(["true", "false"]).transform((value) => value === "true"),
    gracePeriodDays: z.coerce.number().int().min(0).optional(),
  })
  .refine((data) => data.minTermMonths === undefined || data.minTermMonths <= data.maxTermMonths, {
    message: "The minimum term can't be longer than the maximum term",
    path: ["minTermMonths"],
  });

export type LoanPolicyFormInput = z.infer<typeof loanPolicyFormSchema>;

export const loanApplicationSchema = z.object({
  amountMajorUnits: z.coerce.number().positive("Enter an amount greater than zero"),
  termMonths: z.coerce.number().int().positive("Enter a repayment term"),
  purpose: z.string().max(500, "Keep the purpose under 500 characters").optional(),
});

export type LoanApplicationInput = z.infer<typeof loanApplicationSchema>;

export const loanDecisionSchema = z
  .object({
    decision: z.enum(["approved", "rejected"]),
    approvedAmountMajorUnits: z.coerce.number().positive().optional(),
    approvedTermMonths: z.coerce.number().int().positive().optional(),
    approvedInterestRatePercent: z.coerce.number().min(0).optional(),
    approvedRepaymentFrequency: z.enum(CONTRIBUTION_FREQUENCIES).optional(),
    notes: z.string().max(1000, "Keep notes under 1000 characters").optional(),
  })
  .refine(
    (data) =>
      data.decision !== "approved" ||
      (data.approvedAmountMajorUnits !== undefined &&
        data.approvedTermMonths !== undefined &&
        data.approvedInterestRatePercent !== undefined &&
        data.approvedRepaymentFrequency !== undefined),
    {
      message: "Enter the approved amount, term, interest rate and repayment frequency",
      path: ["approvedAmountMajorUnits"],
    },
  );

export type LoanDecisionInput = z.infer<typeof loanDecisionSchema>;

export const disbursementSchema = z.object({
  disbursementDate: isoDateSchema.refine((value) => value <= todayISO(), "The disbursement date can't be in the future"),
  disbursementReference: z.string().max(120, "Keep the reference under 120 characters").optional(),
  disbursementNote: z.string().max(1000, "Keep the note under 1000 characters").optional(),
});

export type DisbursementInput = z.infer<typeof disbursementSchema>;

export const recordRepaymentSchema = z.object({
  amountMajorUnits: z.coerce.number().positive("Enter an amount greater than zero"),
  receivedAt: isoDateSchema.refine((value) => value <= todayISO(), "The date received can't be in the future"),
  paymentMethod: z.enum(PAYMENT_METHODS),
  paymentReference: z.string().max(120, "Keep the reference under 120 characters").optional(),
  notes: z.string().max(1000, "Keep notes under 1000 characters").optional(),
});

export type RecordRepaymentInput = z.infer<typeof recordRepaymentSchema>;

export const reverseRepaymentSchema = reasonSchema.extend({
  createReplacement: z.enum(["true", "false"]).transform((value) => value === "true"),
  amountMajorUnits: z.coerce.number().positive().optional(),
  receivedAt: isoDateSchema.optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  paymentReference: z.string().max(120).optional(),
  notes: z.string().max(1000).optional(),
});

export type ReverseRepaymentInput = z.infer<typeof reverseRepaymentSchema>;
