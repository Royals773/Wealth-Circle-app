import type { AuthActionState } from "./auth";
import type { OnboardingActionState } from "./onboarding";
import type { InvitationActionState } from "./invitations";
import type { ContributionActionState } from "./contributions";

/**
 * Initial useActionState values, kept out of the "use server" action
 * files themselves — a "use server" file may only export async
 * functions, never a plain value like these constants.
 */
export const initialAuthActionState: AuthActionState = { status: "idle" };
export const initialOnboardingActionState: OnboardingActionState = { status: "idle" };
export const initialInvitationActionState: InvitationActionState = { status: "idle" };
export const initialContributionActionState: ContributionActionState = { status: "idle" };
