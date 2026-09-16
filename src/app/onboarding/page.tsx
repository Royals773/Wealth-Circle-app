import type { Metadata } from "next";
import Link from "next/link";
import { PlusCircle, UserPlus } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Get started" };

export default function OnboardingPage() {
  return (
    <div>
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[1.75rem]">
          Let&apos;s get your group set up
        </h1>
        <p className="mt-2 text-muted-foreground">
          You can belong to more than one group, so you can always add another later.
        </p>
      </div>

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <Link href="/onboarding/new" className="group">
          <Card className="h-full transition-all group-hover:shadow-md group-hover:ring-primary/40">
            <CardHeader>
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
                <PlusCircle aria-hidden className="h-5 w-5 text-primary" />
              </div>
              <CardTitle className="mt-3">Create a new group</CardTitle>
              <CardDescription>
                Set up a new workspace for your savings group, susu circle, club, or
                association and invite your members.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link href="/onboarding/join" className="group">
          <Card className="h-full transition-all group-hover:shadow-md group-hover:ring-primary/40">
            <CardHeader>
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
                <UserPlus aria-hidden className="h-5 w-5 text-primary" />
              </div>
              <CardTitle className="mt-3">Join an existing group</CardTitle>
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
