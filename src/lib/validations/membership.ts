import { z } from "zod";
import { reasonSchema } from "@/lib/validations/contributions";

export { reasonSchema };

/** A manager can assign any role except 'owner' — ownership only ever
 * changes via the transfer workflow, never this picker. Matches the
 * check inside change_member_role() exactly. */
export const ASSIGNABLE_ROLES = ["administrator", "treasurer", "loan_officer", "auditor", "member"] as const;

export const changeRoleSchema = z.object({
  newRole: z.enum(ASSIGNABLE_ROLES),
  ...reasonSchema.shape,
});

export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;

export const optionalReasonSchema = z.object({
  reason: z.string().max(1000, "Keep the reason under 1000 characters").optional(),
});

export type OptionalReasonInput = z.infer<typeof optionalReasonSchema>;

export const initiateTransferSchema = z.object({
  toUserId: z.string().uuid(),
  ...reasonSchema.shape,
});

export type InitiateTransferInput = z.infer<typeof initiateTransferSchema>;
