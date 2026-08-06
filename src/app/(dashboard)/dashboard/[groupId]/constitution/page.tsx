import type { Metadata } from "next";
import { FileText, Download } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PublishConstitutionForm } from "@/components/dashboard/publish-constitution-form";
import { AcknowledgeConstitutionButton } from "@/components/dashboard/acknowledge-constitution-button";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMembershipRole } from "@/lib/data/current-membership";
import { roleHasCapability } from "@/lib/permissions";
import {
  loadConstitutionGateStatus,
  loadConstitutionVersions,
  getConstitutionDownloadUrl,
  hasAcknowledgedConstitution,
} from "@/lib/data/constitution";

export const metadata: Metadata = { title: "Constitution" };

export default async function ConstitutionPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;

  if (!isSupabaseConfigured) {
    return (
      <div>
        <PageHeader title="Constitution" description="Your group's governing document." />
        <EmptyState icon={FileText} title="Not available yet" description="Supabase isn't configured yet." />
      </div>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const currentRole = await getCurrentMembershipRole(groupId);
  const canManage = currentRole !== null && roleHasCapability(currentRole, "manage_constitution");

  if (!user || currentRole === null) {
    return (
      <div>
        <PageHeader title="Constitution" description="Your group's governing document." />
        <EmptyState icon={FileText} title="Not available" description="You don't have access to this group." />
      </div>
    );
  }

  const [gate, versions] = await Promise.all([
    loadConstitutionGateStatus(groupId, user.id),
    canManage ? loadConstitutionVersions(groupId) : Promise.resolve([]),
  ]);

  const hasAcknowledgedCurrent = gate.current ? await hasAcknowledgedConstitution(groupId, gate.current.id, user.id) : false;
  const downloadUrl = gate.current ? await getConstitutionDownloadUrl(gate.current.storagePath) : null;

  return (
    <div>
      <PageHeader
        title="Constitution"
        description="Your group's governing document — the rules the group has agreed to operate under."
      />

      {!gate.hasConstitution ? (
        <>
          <EmptyState
            icon={FileText}
            title="No constitution published yet"
            description={
              canManage
                ? "Publish a PDF below so members can review and acknowledge it."
                : "Your group's owner or an administrator hasn't published a constitution yet."
            }
          />
          {canManage ? <div className="mt-6"><PublishConstitutionForm groupId={groupId} nextVersion={1} /></div> : null}
        </>
      ) : (
        <div className="space-y-6">
          {!gate.hasAcknowledgedAny ? (
            <Card className="border-warning/40 bg-warning/10">
              <CardHeader>
                <CardTitle>Please review and sign this constitution</CardTitle>
                <CardDescription>
                  You need to acknowledge your group&apos;s constitution before you can access the rest of this
                  group&apos;s features.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>
                {gate.current!.title} — version {gate.current!.version}
              </CardTitle>
              <CardDescription>
                Published {new Date(gate.current!.publishedAt).toLocaleDateString("en-GB")}
                {gate.current!.note ? ` — ${gate.current!.note}` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {downloadUrl ? (
                <Button asChild variant="outline" size="sm">
                  <a href={downloadUrl} target="_blank" rel="noopener noreferrer">
                    <Download className="mr-2 h-4 w-4" />
                    Download PDF
                  </a>
                </Button>
              ) : (
                <p className="text-sm text-destructive">Couldn&apos;t generate a download link. Try reloading.</p>
              )}

              {!hasAcknowledgedCurrent ? (
                <AcknowledgeConstitutionButton
                  groupId={groupId}
                  constitutionId={gate.current!.id}
                  label={gate.hasAcknowledgedAny ? "Re-acknowledge this version" : "I have read and agree to this constitution"}
                />
              ) : (
                <p className="text-sm text-muted-foreground">You&apos;ve acknowledged this version.</p>
              )}
            </CardContent>
          </Card>

          {canManage ? (
            <>
              <PublishConstitutionForm groupId={groupId} nextVersion={(versions[0]?.version ?? 0) + 1} />

              <Card>
                <CardHeader>
                  <CardTitle>Version history</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Version</TableHead>
                          <TableHead>Title</TableHead>
                          <TableHead>Published</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {versions.map((v) => (
                          <TableRow key={v.id}>
                            <TableCell>{v.version}</TableCell>
                            <TableCell>{v.title}</TableCell>
                            <TableCell>{new Date(v.publishedAt).toLocaleDateString("en-GB")}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
