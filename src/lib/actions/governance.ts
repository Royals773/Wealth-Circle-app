"use server";

import { revalidatePath } from "next/cache";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { createProposalSchema, reasonSchema, voteSchema } from "@/lib/validations/governance";

export interface GovernanceActionState {
  status: "idle" | "error" | "success";
  formError?: string;
  fieldErrors?: Record<string, string>;
}

const NOT_CONFIGURED_MESSAGE =
  "This isn't available in this preview yet — Supabase credentials haven't been configured.";

function fieldErrorsFromZod(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}

export async function createGovernanceProposalAction(
  groupId: string,
  _prevState: GovernanceActionState,
  formData: FormData,
): Promise<GovernanceActionState> {
  const parsed = createProposalSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    category: formData.get("category") || undefined,
    votingOpensAt: formData.get("votingOpensAt"),
    votingClosesAt: formData.get("votingClosesAt"),
    quorumPercent: formData.get("quorumPercent") || undefined,
    approvalThresholdPercent: formData.get("approvalThresholdPercent") || 50,
  });

  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  if (!isSupabaseConfigured) {
    return { status: "error", formError: NOT_CONFIGURED_MESSAGE };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_governance_proposal", {
    p_group_id: groupId,
    p_title: parsed.data.title,
    p_description: parsed.data.description ?? null,
    p_category: parsed.data.category ?? null,
    p_voting_opens_at: new Date(parsed.data.votingOpensAt).toISOString(),
    p_voting_closes_at: new Date(parsed.data.votingClosesAt).toISOString(),
    p_quorum_percent: parsed.data.quorumPercent ?? null,
    p_approval_threshold_percent: parsed.data.approvalThresholdPercent,
  });

  if (error) {
    return { status: "error", formError: error.message };
  }

  revalidatePath(`/dashboard/${groupId}/governance`);
  return { status: "success" };
}

export async function cancelGovernanceProposalAction(
  groupId: string,
  _prevState: GovernanceActionState,
  formData: FormData,
): Promise<GovernanceActionState> {
  const proposalId = String(formData.get("proposalId") ?? "");
  const parsed = reasonSchema.safeParse({ reason: formData.get("reason") });

  if (!parsed.success || !proposalId) {
    return { status: "error", fieldErrors: parsed.success ? {} : fieldErrorsFromZod(parsed.error) };
  }

  if (!isSupabaseConfigured) {
    return { status: "error", formError: NOT_CONFIGURED_MESSAGE };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_governance_proposal", {
    p_proposal_id: proposalId,
    p_reason: parsed.data.reason,
  });

  if (error) {
    return { status: "error", formError: error.message };
  }

  revalidatePath(`/dashboard/${groupId}/governance`);
  return { status: "success" };
}

export async function castVoteAction(groupId: string, proposalId: string, choice: string): Promise<{ error?: string }> {
  if (!isSupabaseConfigured) return { error: NOT_CONFIGURED_MESSAGE };

  const parsed = voteSchema.safeParse({ choice });
  if (!parsed.success) return { error: "Invalid vote choice." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("cast_vote", {
    p_proposal_id: proposalId,
    p_choice: parsed.data.choice,
  });

  if (error) return { error: error.message };

  revalidatePath(`/dashboard/${groupId}/governance`);
  revalidatePath(`/dashboard/${groupId}`);
  return {};
}
