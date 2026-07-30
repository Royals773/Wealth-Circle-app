import { z } from "zod";
import { CONTRIBUTION_FREQUENCIES } from "@/lib/validations/group";

export const PAYMENT_METHODS = ["cash", "bank_transfer", "mobile_money", "cheque", "other"] as const;

export const PAYMENT_METHOD_LABELS: Record<(typeof PAYMENT_METHODS)[number], string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  mobile_money: "Mobile money",
  cheque: "Cheque",
  other: "Other",
};

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date");

export const contributionPlanFormSchema = z
  .object({
    isFlexible: z.enum(["fixed", "flexible"]).transform((value) => value === "flexible"),
    amountMajorUnits: z.coerce.number().positive().optional(),
    minimumAmountMajorUnits: z.coerce.number().positive().optional(),
    frequency: z.enum(CONTRIBUTION_FREQUENCIES),
  })
  .refine((data) => data.isFlexible || data.amountMajorUnits !== undefined, {
    message: "Enter the fixed contribution amount",
    path: ["amountMajorUnits"],
  });

export type ContributionPlanFormInput = z.infer<typeof contributionPlanFormSchema>;

export const recordContributionSchema = z.object({
  memberId: z.string().uuid("Select a member"),
  amountMajorUnits: z.coerce.number().positive("Enter an amount greater than zero"),
  periodDate: isoDateSchema,
  receivedAt: isoDateSchema.refine(
    (value) => value <= new Date().toISOString().slice(0, 10),
    "The date received can't be in the future",
  ),
  paymentMethod: z.enum(PAYMENT_METHODS),
  paymentReference: z.string().max(120, "Keep the reference under 120 characters").optional(),
  notes: z.string().max(1000, "Keep notes under 1000 characters").optional(),
});

export type RecordContributionInput = z.infer<typeof recordContributionSchema>;

export const reasonSchema = z.object({
  reason: z
    .string()
    .min(5, "Enter a reason (at least 5 characters)")
    .max(1000, "Keep the reason under 1000 characters"),
});

export const reverseContributionSchema = reasonSchema.extend({
  createReplacement: z.enum(["true", "false"]).transform((value) => value === "true"),
  amountMajorUnits: z.coerce.number().positive().optional(),
  periodDate: isoDateSchema.optional(),
  receivedAt: isoDateSchema.optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  paymentReference: z.string().max(120).optional(),
  notes: z.string().max(1000).optional(),
});

export type ReverseContributionInput = z.infer<typeof reverseContributionSchema>;
