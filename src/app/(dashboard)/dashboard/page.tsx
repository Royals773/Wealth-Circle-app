import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Users2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardIndexPage() {
  if (!isSupabaseConfigured) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-secondary/30 px-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
          <Users2 aria-hidden className="h-6 w-6 text-muted-foreground" />
        </div>
        <h1 className="text-xl font-semibold text-foreground">Dashboard preview</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Supabase credentials haven&apos;t been configured, so there&apos;s no live group data
          to load. You can still browse the dashboard structure with placeholder data.
        </p>
        <div className="flex gap-3">
          <Button asChild>
            <Link href="/dashboard/preview">View dashboard structure</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/">Back to home</Link>
          </Button>
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in?next=/dashboard");
  }

  const { data: memberships } = await supabase
    .from("group_memberships")
    .select("group_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1);

  if (memberships && memberships.length > 0) {
    redirect(`/dashboard/${memberships[0].group_id}`);
  }

  redirect("/onboarding");
}
