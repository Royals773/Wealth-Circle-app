import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { loadMyOrganiserApplication } from "@/lib/data/organiser";
import { ApplyOrganiserForm } from "@/components/onboarding/apply-organiser-form";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { CheckCircle2, Clock, Ban, XCircle } from "lucide-react";

export const metadata: Metadata = { title: "Apply to become an organiser" };

export default async function ApplyOrganiserPage() {
  if (isSupabaseConfigured) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      redirect("/sign-in?next=/apply-organiser");
    }
  }

  const application = await loadMyOrganiserApplication();

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Apply to become an organiser
        </h1>
        <p className="mt-2 text-muted-foreground">
          Creating a group requires an approved organiser application, reviewed by a platform
          administrator. Ordinary members who only join groups don&apos;t need to apply.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          {application?.status === "approved" ? (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                You&apos;re an approved organiser. You can create a group whenever you&apos;re
                ready.
              </AlertDescription>
            </Alert>
          ) : application?.status === "pending" ? (
            <Alert>
              <Clock className="h-4 w-4" />
              <AlertDescription>
                Your application is awaiting review by a platform administrator.
              </AlertDescription>
            </Alert>
          ) : application?.status === "suspended" ? (
            <Alert variant="destructive">
              <Ban className="h-4 w-4" />
              <AlertDescription>
                Your organiser access is currently suspended. Contact a platform administrator
                for details.
              </AlertDescription>
            </Alert>
          ) : application?.status === "rejected" ? (
            <div className="space-y-4">
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertDescription>
                  Your previous application was not approved
                  {application.decisionReason ? `: ${application.decisionReason}` : "."}
                </AlertDescription>
              </Alert>
              <ApplyOrganiserForm />
            </div>
          ) : (
            <ApplyOrganiserForm />
          )}

          {application?.status === "approved" ? (
            <Button asChild className="mt-6 w-full">
              <Link href="/onboarding/new">Create a group</Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
