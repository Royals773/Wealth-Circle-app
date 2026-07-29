import { z } from "zod";

export const CONTRIBUTION_FREQUENCIES = [
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "annually",
] as const;

export const CONTRIBUTION_FREQUENCY_LABELS: Record<
  (typeof CONTRIBUTION_FREQUENCIES)[number],
  string
> = {
  weekly: "Weekly",
  biweekly: "Every two weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annually: "Annually",
};

export const CONTRIBUTION_TYPES = ["fixed", "flexible"] as const;

const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const groupDetailsSchema = z.object({
  name: z.string().min(2, "Group name must be at least 2 characters").max(120),
  slug: z
    .string()
    .min(2, "URL slug must be at least 2 characters")
    .max(60)
    .regex(slugPattern, "Use lowercase letters, numbers and hyphens only"),
  description: z.string().max(500, "Keep the description under 500 characters").optional(),
  countryCode: z.string().length(2, "Select a country"),
  currencyCode: z.string().length(3, "Select a currency"),
});

export type GroupDetailsInput = z.infer<typeof groupDetailsSchema>;

export const groupContributionSettingsSchema = z
  .object({
    contributionFrequency: z.enum(CONTRIBUTION_FREQUENCIES),
    contributionType: z.enum(CONTRIBUTION_TYPES),
    fixedAmountMajorUnits: z.coerce.number().positive().optional(),
    financialYearStartMonth: z.coerce.number().int().min(1).max(12),
  })
  .refine(
    (data) => data.contributionType !== "fixed" || data.fixedAmountMajorUnits !== undefined,
    {
      message: "Enter the fixed contribution amount",
      path: ["fixedAmountMajorUnits"],
    },
  );

export type GroupContributionSettingsInput = z.infer<typeof groupContributionSettingsSchema>;

export const groupRulesSchema = z.object({
  rules: z.string().max(4000, "Keep group rules under 4000 characters").optional(),
});

export type GroupRulesInput = z.infer<typeof groupRulesSchema>;

export const GROUP_INVITE_ROLES = [
  "administrator",
  "treasurer",
  "loan_officer",
  "auditor",
  "member",
] as const;

export const initialInviteSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  role: z.enum(GROUP_INVITE_ROLES),
});

export const groupInvitesSchema = z.object({
  invites: z.array(initialInviteSchema).max(50, "Invite up to 50 people at a time"),
});

export type GroupInvitesInput = z.infer<typeof groupInvitesSchema>;

export const createGroupSchema = groupDetailsSchema
  .and(
    z.object({
      contributionFrequency: z.enum(CONTRIBUTION_FREQUENCIES),
      contributionType: z.enum(CONTRIBUTION_TYPES),
      fixedAmountMajorUnits: z.coerce.number().positive().optional(),
      financialYearStartMonth: z.coerce.number().int().min(1).max(12),
      rules: z.string().max(4000).optional(),
    }),
  )
  .and(groupInvitesSchema);

export type CreateGroupInput = z.infer<typeof createGroupSchema>;

export const joinGroupSchema = z.object({
  invitationToken: z.string().uuid("This invitation link is invalid"),
});

export type JoinGroupInput = z.infer<typeof joinGroupSchema>;
