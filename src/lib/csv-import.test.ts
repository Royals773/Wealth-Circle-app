import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvWithHeader } from "@/lib/csv-import";

describe("parseCsv", () => {
  it("parses a simple unquoted file", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted fields containing commas", () => {
    expect(parseCsv('name,note\n"Doe, Jane","says ""hi"""')).toEqual([
      ["name", "note"],
      ["Doe, Jane", 'says "hi"'],
    ]);
  });

  it("handles quoted fields containing newlines", () => {
    expect(parseCsv('a,b\n"line1\nline2",x')).toEqual([
      ["a", "b"],
      ["line1\nline2", "x"],
    ]);
  });

  it("normalizes CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("drops a spurious trailing blank row from a trailing newline", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("parseCsvWithHeader", () => {
  it("keys each row by the lowercased, trimmed header", () => {
    const result = parseCsvWithHeader("Member Identifier,Amount, Received At\nme@example.com,50.00,2024-01-15");
    expect(result.headers).toEqual(["member identifier", "amount", "received at"]);
    expect(result.rows).toEqual([{ "member identifier": "me@example.com", amount: "50.00", "received at": "2024-01-15" }]);
  });

  it("returns empty output for an empty file", () => {
    expect(parseCsvWithHeader("")).toEqual({ headers: [], rows: [] });
  });
});
