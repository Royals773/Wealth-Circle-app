import type { Metadata } from "next";
import { CreateGroupWizard } from "@/components/onboarding/create-group-wizard";

export const metadata: Metadata = { title: "Create a group" };

export default function NewGroupPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Create your group
        </h1>
        <p className="mt-2 text-muted-foreground">
          This takes about five minutes. You can change most of this later in group settings.
        </p>
      </div>
      <CreateGroupWizard />
    </div>
  );
}
