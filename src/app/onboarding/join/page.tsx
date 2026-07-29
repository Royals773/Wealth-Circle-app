import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { JoinGroupForm } from "@/components/onboarding/join-group-form";

export const metadata: Metadata = { title: "Join a group" };

export default function JoinGroupPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Join a group</CardTitle>
        <CardDescription>
          Ask the group&apos;s owner or administrator for an invitation, then paste the link or
          code below.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <JoinGroupForm />
      </CardContent>
    </Card>
  );
}
