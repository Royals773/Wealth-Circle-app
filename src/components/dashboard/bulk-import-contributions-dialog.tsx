"use client";

import { useRef, useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertCircle, Upload } from "lucide-react";
import { parseCsvWithHeader } from "@/lib/csv-import";
import { bulkImportRowSchema, type BulkImportRow } from "@/lib/validations/backdated-contributions";
import {
  previewBulkImportAction,
  commitBulkImportAction,
  type BulkImportRowResult,
} from "@/lib/actions/backdated-contributions";

const REQUIRED_HEADERS = ["member_identifier", "amount", "received_at"] as const;

/** Exported so the stage/result → header-variant mapping is directly
 * testable without rendering the Radix Dialog portal (which produces
 * empty output under renderToStaticMarkup — see remove-member-dialog.tsx).
 * "committed" is the deliberate result state: success once every row
 * imported, warning the moment any row failed — upload/preview stay the
 * calm default since nothing has actually happened yet. */
export function bulkImportHeaderVariant(stage: "upload" | "preview" | "committed", failedCount: number) {
  if (stage !== "committed") return "default";
  return failedCount > 0 ? "warning" : "success";
}

function parseFile(text: string): { rows: BulkImportRow[]; error: string | null } {
  const { headers, rows } = parseCsvWithHeader(text);
  if (rows.length === 0) {
    return { rows: [], error: "The file has no data rows." };
  }
  const missing = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    return { rows: [], error: `Missing required column(s): ${missing.join(", ")}. Expected headers: member_identifier, amount, received_at, note (optional).` };
  }

  const parsedRows: BulkImportRow[] = [];
  for (const row of rows) {
    const result = bulkImportRowSchema.safeParse({
      memberIdentifier: row.member_identifier,
      amountMajorUnits: row.amount,
      receivedAt: row.received_at,
      note: row.note || undefined,
    });
    // Malformed individual cells are still sent through to the server —
    // it reports them as a per-row failure with a clear reason, rather
    // than us silently dropping the row here.
    parsedRows.push(
      result.success
        ? result.data
        : { memberIdentifier: row.member_identifier || "(blank)", amountMajorUnits: NaN, receivedAt: row.received_at || "", note: row.note },
    );
  }
  return { rows: parsedRows, error: null };
}

function summarize(results: BulkImportRowResult[]) {
  const succeeded = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);
  const totalMajorUnits = null; // amounts aren't echoed back by the RPC; total is computed from the source rows instead
  return { succeeded, failed, totalMajorUnits };
}

export function BulkImportContributionsDialog({ groupId }: { groupId: string }) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<"upload" | "preview" | "committed">("upload");
  const [rows, setRows] = useState<BulkImportRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [confirmImplausible, setConfirmImplausible] = useState(false);
  const [results, setResults] = useState<BulkImportRowResult[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setStage("upload");
    setRows([]);
    setParseError(null);
    setConfirmImplausible(false);
    setResults([]);
    setActionError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleFile(file: File) {
    setActionError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const { rows: parsedRows, error } = parseFile(text);
      if (error) {
        setParseError(error);
        return;
      }
      setParseError(null);
      setRows(parsedRows);
      startTransition(async () => {
        const result = await previewBulkImportAction(groupId, parsedRows, confirmImplausible);
        if ("error" in result) {
          setActionError(result.error);
          return;
        }
        setResults(result.results);
        setStage("preview");
      });
    };
    reader.readAsText(file);
  }

  function rePreview(nextConfirm: boolean) {
    setConfirmImplausible(nextConfirm);
    startTransition(async () => {
      const result = await previewBulkImportAction(groupId, rows, nextConfirm);
      if ("error" in result) {
        setActionError(result.error);
        return;
      }
      setResults(result.results);
    });
  }

  function commit() {
    startTransition(async () => {
      const result = await commitBulkImportAction(groupId, rows, confirmImplausible);
      if ("error" in result) {
        setActionError(result.error);
        return;
      }
      setResults(result.results);
      setStage("committed");
    });
  }

  const { succeeded, failed } = summarize(results);
  const headerVariant = bulkImportHeaderVariant(stage, failed.length);
  const hasImplausibleDateFailures = failed.some((r) => r.errorMessage?.toLowerCase().includes("implausible date"));
  const totalAmountMajor = rows
    .filter((_, i) => results[i]?.success)
    .reduce((sum, r) => sum + (Number.isFinite(r.amountMajorUnits) ? r.amountMajorUnits : 0), 0);
  const dates = rows.map((r) => r.receivedAt).filter(Boolean).sort();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Upload className="h-4 w-4" /> Bulk import (CSV)
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader variant={headerVariant}>
          <DialogTitle>Bulk import historical contributions</DialogTitle>
          <DialogDescription>
            CSV with columns <code>member_identifier</code> (email or in-app member id — never a name),{" "}
            <code>amount</code>, <code>received_at</code> (YYYY-MM-DD), and optional <code>note</code>. Rows for
            people not already in this group are rejected, never auto-created.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {actionError ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          ) : null}
          {parseError ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{parseError}</AlertDescription>
            </Alert>
          ) : null}

          {stage === "upload" ? (
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              disabled={isPending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
              className="block w-full text-sm"
            />
          ) : null}

          {isPending && stage === "upload" ? <p className="text-sm text-muted-foreground">Checking rows…</p> : null}

          {stage === "preview" || stage === "committed" ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3 text-sm">
                <div className="rounded-lg border border-border p-3">
                  <div className="text-muted-foreground">Rows</div>
                  <div className="font-medium">{rows.length}</div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-muted-foreground">{stage === "committed" ? "Imported" : "Would import"}</div>
                  <div className="font-medium">
                    {succeeded.length} of {results.length} ({totalAmountMajor.toFixed(2)} total)
                  </div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <div className="text-muted-foreground">Date range</div>
                  <div className="font-medium">
                    {dates.length > 0 ? `${dates[0]} → ${dates[dates.length - 1]}` : "—"}
                  </div>
                </div>
              </div>

              {failed.length > 0 ? (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {failed.length} row{failed.length === 1 ? "" : "s"} will be rejected — see the table below for why.
                  </AlertDescription>
                </Alert>
              ) : null}

              {stage === "preview" && hasImplausibleDateFailures ? (
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={confirmImplausible}
                    onCheckedChange={(checked) => rePreview(checked === true)}
                  />
                  <span>
                    Some dates are in the future or before this group existed. If that&apos;s genuinely correct,
                    check this to include them.
                  </span>
                </label>
              ) : null}

              <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Row</TableHead>
                      <TableHead>Member</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Result</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((r, i) => (
                      <TableRow key={r.rowIndex}>
                        <TableCell className="text-muted-foreground">{r.rowIndex}</TableCell>
                        <TableCell>{r.memberIdentifier}</TableCell>
                        <TableCell className="text-muted-foreground">{rows[i]?.receivedAt}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {Number.isFinite(rows[i]?.amountMajorUnits) ? rows[i].amountMajorUnits.toFixed(2) : "—"}
                        </TableCell>
                        <TableCell>
                          {r.success ? (
                            <Badge variant="secondary">Will import</Badge>
                          ) : (
                            <span className="text-xs text-destructive">{r.errorMessage}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : null}
        </div>

        <DialogFooter className="mt-2">
          {stage === "preview" ? (
            <Button type="button" onClick={commit} disabled={isPending || succeeded.length === 0}>
              {isPending ? "Importing…" : `Import ${succeeded.length} contribution${succeeded.length === 1 ? "" : "s"}`}
            </Button>
          ) : stage === "committed" ? (
            <Button type="button" onClick={() => setOpen(false)}>
              Done
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
