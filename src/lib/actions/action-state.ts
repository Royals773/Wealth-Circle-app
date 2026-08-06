import type { AuthActionState } from "./auth";
import type { OnboardingActionState } from "./onboarding";
import type { InvitationActionState } from "./invitations";
import type { ContributionActionState } from "./contributions";
import type { LoanActionState } from "./loans";
import type { WithdrawalActionState } from "./withdrawals";
import type { GovernanceActionState } from "./governance";
import type { MembershipActionState } from "./membership";
import type { ConstitutionActionState } from "./constitution";
import type { BackdatedContributionActionState } from "./backdated-contributions";

/**
 * Initial useActionState values, kept out of the "use server" action
 * files themselves — a "use server" file may only export async
 * functions, never a plain value like these constants.
 */
export const initialAuthActionState: AuthActionState = { status: "idle" };
export const initialOnboardingActionState: OnboardingActionState = { status: "idle" };
export const initialInvitationActionState: InvitationActionState = { status: "idle" };
export const initialContributionActionState: ContributionActionState = { status: "idle" };
export const initialLoanActionState: LoanActionState = { status: "idle" };
export const initialWithdrawalActionState: WithdrawalActionState = { status: "idle" };
export const initialGovernanceActionState: GovernanceActionState = { status: "idle" };
export const initialMembershipActionState: MembershipActionState = { status: "idle" };
export const initialConstitutionActionState: ConstitutionActionState = { status: "idle" };
export const initialBackdatedContributionActionState: BackdatedContributionActionState = { status: "idle" };
