import { describe, expect, it } from "vitest";
import { bulkImportHeaderVariant } from "@/components/dashboard/bulk-import-contributions-dialog";

// Regression for bulk import's deliberate result-state handling: the header
// must stay calm while nothing has happened yet (upload/preview), then
// reflect the actual outcome once committed — success only if every row
// imported, warning the moment any row failed.
describe("bulkImportHeaderVariant", () => {
  it("stays default during upload, regardless of failure count", () => {
    expect(bulkImportHeaderVariant("upload", 0)).toBe("default");
    expect(bulkImportHeaderVariant("upload", 3)).toBe("default");
  });

  it("stays default during preview, regardless of failure count", () => {
    expect(bulkImportHeaderVariant("preview", 0)).toBe("default");
    expect(bulkImportHeaderVariant("preview", 5)).toBe("default");
  });

  it("is success once committed with zero failed rows", () => {
    expect(bulkImportHeaderVariant("committed", 0)).toBe("success");
  });

  it("is warning once committed with at least one failed row", () => {
    expect(bulkImportHeaderVariant("committed", 1)).toBe("warning");
    expect(bulkImportHeaderVariant("committed", 4)).toBe("warning");
  });
});
