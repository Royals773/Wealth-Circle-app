import { z } from "zod";

export const publishConstitutionSchema = z.object({
  groupId: z.string().uuid(),
  title: z.string().trim().min(1, "Title is required").max(200, "Keep the title under 200 characters"),
  note: z.string().trim().max(1000, "Keep the note under 1000 characters").optional().or(z.literal("")),
});

export type PublishConstitutionInput = z.infer<typeof publishConstitutionSchema>;

export const MAX_CONSTITUTION_FILE_BYTES = 20 * 1024 * 1024; // 20MB

/**
 * Size/presence only — deliberately does not check `file.type` or the
 * filename. A browser-reported MIME type is just a client-supplied
 * string on the multipart part; a direct POST to this Server Action
 * (bypassing the form entirely) can set it to anything. `file.size`,
 * by contrast, reflects bytes actually received, not a claim, so it's
 * safe to trust. The real type check is `hasPdfMagicBytes()` below,
 * which this function deliberately leaves to the caller so it can
 * report a synchronous, fast-fail result before ever reading the
 * file's contents.
 */
export function validateConstitutionFile(file: File | null): string | null {
  if (!file || file.size === 0) return "Choose a PDF file to upload";
  if (file.size > MAX_CONSTITUTION_FILE_BYTES) return "The PDF must be under 20MB";
  return null;
}

const PDF_MAGIC_BYTES = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-", the real file signature every valid PDF starts with

/**
 * The authoritative "is this actually a PDF" check — inspects the
 * file's real leading bytes, not the filename or the client-supplied
 * `file.type`. Renaming a non-PDF file to `.pdf`, or spoofing the
 * multipart Content-Type header on a direct API call, both fail this
 * check, since neither changes the file's actual byte content.
 */
export async function hasPdfMagicBytes(file: File): Promise<boolean> {
  const header = new Uint8Array(await file.slice(0, PDF_MAGIC_BYTES.length).arrayBuffer());
  return PDF_MAGIC_BYTES.every((byte, i) => header[i] === byte);
}

export const acknowledgeConstitutionSchema = z.object({
  constitutionId: z.string().uuid(),
});
