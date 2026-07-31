import { z } from "zod";
import { reasonSchema } from "@/lib/validations/contributions";

export { reasonSchema };

const isoDateTimeSchema = z.string().min(1, "A date and time is required");

export const createProposalSchema = z
  .object({
    title: z.string().trim().min(1, "A title is required").max(200, "Keep the title under 200 characters"),
    description: z.string().max(4000, "Keep the description under 4000 characters").optional(),
    category: z.string().max(60, "Keep the category under 60 characters").optional(),
    votingOpensAt: isoDateTimeSchema,
    votingClosesAt: isoDateTimeSchema,
    quorumPercent: z.coerce.number().min(0).max(100).optional(),
    approvalThresholdPercent: z.coerce.number().positive("Enter a percentage greater than zero").max(100),
  })
  .refine((data) => new Date(data.votingClosesAt) > new Date(data.votingOpensAt), {
    message: "The voting window must close after it opens",
    path: ["votingClosesAt"],
  });

export type CreateProposalInput = z.infer<typeof createProposalSchema>;

export const voteSchema = z.object({
  choice: z.enum(["for", "against", "abstain"]),
});

export type VoteInput = z.infer<typeof voteSchema>;
