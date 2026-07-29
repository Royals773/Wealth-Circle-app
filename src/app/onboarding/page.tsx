import type { Metadata } from "next";
import Link from "next/link";
import { PlusCircle, UserPlus } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Get started" };

export default function OnboardingPage() {
  return (
    <div>
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Let&apos;s get your group set up
        </h1>
        <p className="mt-2 text-muted-foreground">
          You can belong to more than one group, so you can always add another later.
        </p>
      </div>

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <Link href="/onboarding/new" className="group">
          <Card className="h-full transition-colors group-hover:border-primary">
            <CardHeader>
              <PlusCircle aria-hidden className="h-7 w-7 text-primary" />
              <CardTitle className="mt-2">Create a new group</CardTitle>
              <CardDescription>
                Set up a new workspace for your savings group, susu circle, club, or
                association and invite your members.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link href="/onboarding/join" className="group">
          <Card className="h-full transition-colors group-hover:border-primary">
            <CardHeader>
              <UserPlus aria-hidden className="h-7 w-7 text-primary" />
              <CardTitle className="mt-2">Join an existing group</CardTitle>
              <CardDescription>
                Use an invitation link or code from a group owner or administrator to join
                their group.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>
    </div>
  );
}
