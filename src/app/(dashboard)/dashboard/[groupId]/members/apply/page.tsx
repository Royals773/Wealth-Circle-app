import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/dashboard/page-header";
import { MemberProfileForm } from "@/components/dashboard/member-profile-form";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Member profile" };

export default async function MemberProfileApplyPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;

  if (!isSupabaseConfigured) {
    return (
      <div>
        <PageHeader title="Member profile" description="Supabase isn't configured yet." />
      </div>
    );
  }

  const supabase = await createClient();
  const { data: group } = await supabase.from("groups").select("id, name").eq("id", groupId).single();

  if (!group) {
    notFound();
  }

  return (
    <div>
      <PageHeader
        title="Member profile"
        description="Provide your personal, contact and emergency-contact details for this group's records."
      />
      <MemberProfileForm group={{ id: group.id, name: group.name }} />
    </div>
  );
}
