import { z } from "zod";

export const recordBackdatedContributionSchema = z.object({
  groupId: z.string().uuid(),
  memberId: z.string().uuid(),
  amountMajorUnits: z.coerce.number().positive("Enter an amount greater than zero"),
  receivedAt: z.string().min(1, "A contribution date is required"),
  note: z.string().trim().max(1000, "Keep the note under 1000 characters").optional().or(z.literal("")),
  confirmImplausibleDate: z.coerce.boolean().optional().default(false),
});

export type RecordBackdatedContributionInput = z.infer<typeof recordBackdatedContributionSchema>;

export const MAX_BULK_IMPORT_ROWS = 2000;

export const bulkImportRowSchema = z.object({
  memberIdentifier: z.string().trim().min(1, "Missing member identifier"),
  amountMajorUnits: z.coerce.number().positive("Amount must be greater than zero"),
  receivedAt: z.string().min(1, "A contribution date is required"),
  note: z.string().trim().max(1000).optional().or(z.literal("")),
});

export type BulkImportRow = z.infer<typeof bulkImportRowSchema>;
