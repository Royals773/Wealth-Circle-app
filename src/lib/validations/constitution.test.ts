import { describe, expect, it } from "vitest";
import { validateConstitutionFile, hasPdfMagicBytes, MAX_CONSTITUTION_FILE_BYTES } from "@/lib/validations/constitution";

function fileOf(bytes: Uint8Array, name = "file.pdf") {
  return new File([bytes] as BlobPart[], name);
}

describe("validateConstitutionFile", () => {
  it("rejects a missing file", () => {
    expect(validateConstitutionFile(null)).toMatch(/choose a pdf/i);
  });

  it("rejects an empty file", () => {
    expect(validateConstitutionFile(fileOf(new Uint8Array(0)))).toMatch(/choose a pdf/i);
  });

  it("rejects a file over the 20MB cap", () => {
    const oversized = fileOf(new Uint8Array(MAX_CONSTITUTION_FILE_BYTES + 1));
    expect(validateConstitutionFile(oversized)).toMatch(/20mb/i);
  });

  it("accepts a file within the size cap", () => {
    expect(validateConstitutionFile(fileOf(new Uint8Array(1024)))).toBeNull();
  });
});

describe("hasPdfMagicBytes", () => {
  it("accepts real PDF leading bytes", async () => {
    const pdfBytes = new TextEncoder().encode("%PDF-1.4\n%%EOF");
    expect(await hasPdfMagicBytes(fileOf(pdfBytes))).toBe(true);
  });

  it("rejects a PNG renamed to .pdf (wrong magic bytes, right extension)", async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(await hasPdfMagicBytes(fileOf(pngBytes, "totally-a-pdf.pdf"))).toBe(false);
  });

  it("rejects a plain text file renamed to .pdf", async () => {
    const textBytes = new TextEncoder().encode("This is not a PDF, just text pretending to be one.");
    expect(await hasPdfMagicBytes(fileOf(textBytes, "notes.pdf"))).toBe(false);
  });

  it("rejects an empty file", async () => {
    expect(await hasPdfMagicBytes(fileOf(new Uint8Array(0)))).toBe(false);
  });

  it("rejects a file shorter than the magic byte sequence", async () => {
    const tooShort = new TextEncoder().encode("%PD");
    expect(await hasPdfMagicBytes(fileOf(tooShort))).toBe(false);
  });
});
