import { describe, expect, it } from "vitest";
import { escapeCsvCell, toCsv, toCsvRow, CSV_ROW_LIMIT } from "@/lib/csv";

describe("escapeCsvCell", () => {
  it("leaves ordinary text untouched", () => {
    expect(escapeCsvCell("Jane Doe")).toBe("Jane Doe");
  });

  it("guards a leading equals sign against formula injection", () => {
    expect(escapeCsvCell("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
  });

  it("guards a leading plus sign", () => {
    expect(escapeCsvCell("+1234")).toBe("'+1234");
  });

  it("guards a leading minus sign", () => {
    expect(escapeCsvCell("-1234")).toBe("'-1234");
  });

  it("guards a leading @ sign", () => {
    expect(escapeCsvCell("@cmd|'/c calc'")).toBe("'@cmd|'/c calc'");
  });

  it("does not guard a minus sign that isn't leading", () => {
    expect(escapeCsvCell("100-200")).toBe("100-200");
  });

  it("quotes and escapes a value containing a comma", () => {
    expect(escapeCsvCell("Doe, Jane")).toBe('"Doe, Jane"');
  });

  it("quotes and doubles internal quotes", () => {
    expect(escapeCsvCell('She said "hello"')).toBe('"She said ""hello"""');
  });

  it("quotes a value containing a newline", () => {
    expect(escapeCsvCell("line one\nline two")).toBe('"line one\nline two"');
  });

  it("guards and quotes together when both apply", () => {
    expect(escapeCsvCell("=A1,B1")).toBe("\"'=A1,B1\"");
  });
});

describe("toCsvRow", () => {
  it("joins cells with commas and treats null/undefined as empty", () => {
    expect(toCsvRow(["a", 1, null, undefined, "b"])).toBe("a,1,,,b");
  });
});

describe("toCsv", () => {
  it("renders metadata rows, a blank separator, headers, then data rows", () => {
    const { csv } = toCsv(
      { headers: ["Name", "Amount"], rows: [["Jane", 100]] },
      { "Report type": "Test", "Generated at": "2026-01-01" },
    );
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Report type,Test");
    expect(lines[1]).toBe("Generated at,2026-01-01");
    expect(lines[2]).toBe("");
    expect(lines[3]).toBe("Name,Amount");
    expect(lines[4]).toBe("Jane,100");
  });

  it("omits the metadata block entirely when none is given", () => {
    const { csv } = toCsv({ headers: ["A"], rows: [["1"]] });
    expect(csv.split("\r\n")[0]).toBe("A");
  });

  it("truncates at CSV_ROW_LIMIT and appends a truncation notice", () => {
    const rows = Array.from({ length: CSV_ROW_LIMIT + 5 }, (_, i) => [String(i)]);
    const { csv, truncated, rowCount } = toCsv({ headers: ["N"], rows });
    expect(truncated).toBe(true);
    expect(rowCount).toBe(CSV_ROW_LIMIT);
    expect(csv).toContain(`Truncated at ${CSV_ROW_LIMIT} rows out of ${CSV_ROW_LIMIT + 5} total`);
  });

  it("does not truncate when under the limit", () => {
    const { truncated } = toCsv({ headers: ["N"], rows: [["1"], ["2"]] });
    expect(truncated).toBe(false);
  });
});
