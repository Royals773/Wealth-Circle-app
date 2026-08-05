import { z } from "zod";

const nameField = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(100, `${label} must be under 100 characters`);

// Loose but real: catches obviously-wrong input without assuming a
// single country's phone format, since "mobile phone" here isn't
// restricted to UK members only.
const PHONE_REGEX = /^[+]?[\d\s()-]{7,20}$/;
const phoneField = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .regex(PHONE_REGEX, `${label} doesn't look like a valid phone number`);

function isAdult(dateOfBirth: string): boolean {
  const dob = new Date(dateOfBirth + "T00:00:00Z");
  if (Number.isNaN(dob.getTime())) return false;
  const eighteenYearsAgo = new Date();
  eighteenYearsAgo.setUTCHours(0, 0, 0, 0);
  eighteenYearsAgo.setUTCFullYear(eighteenYearsAgo.getUTCFullYear() - 18);
  return dob <= eighteenYearsAgo;
}

export const GENDER_OPTIONS = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "non_binary", label: "Non-binary" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
] as const;

export const memberProfileSchema = z.object({
  groupId: z.string().uuid("Choose a group"),

  firstName: nameField("First name"),
  middleName: z.string().trim().max(100).optional().or(z.literal("")),
  lastName: nameField("Last name"),
  dateOfBirth: z
    .string()
    .min(1, "Date of birth is required")
    .refine((value) => !Number.isNaN(new Date(value + "T00:00:00Z").getTime()), "Enter a valid date")
    .refine((value) => new Date(value + "T00:00:00Z") <= new Date(), "Date of birth must be in the past")
    .refine(isAdult, "Members must be at least 18 years old"),
  gender: z.enum(["female", "male", "non_binary", "prefer_not_to_say"]).optional(),

  phone: phoneField("Mobile phone"),
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),

  addressLine1: z.string().trim().min(1, "Address line 1 is required").max(200),
  addressLine2: z.string().trim().max(200).optional().or(z.literal("")),
  city: z.string().trim().min(1, "Town/city is required").max(100),
  postcode: z.string().trim().min(1, "Postcode is required").max(20),
  country: z.string().trim().min(1, "Country is required").max(100),

  nextOfKinFullName: nameField("Next of kin's full name"),
  nextOfKinRelationship: z.string().trim().min(1, "Relationship to member is required").max(100),
  nextOfKinPhone: phoneField("Next of kin's phone number"),
  nextOfKinEmail: z.string().trim().email("Enter a valid email address").optional().or(z.literal("")),

  informationConfirmed: z.literal(true, {
    message: "You must confirm the information is accurate before submitting",
  }),
});

export type MemberProfileInput = z.infer<typeof memberProfileSchema>;
