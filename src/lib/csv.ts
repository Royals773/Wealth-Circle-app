/**
 * Pure CSV serialization shared by every report export. Kept separate
 * from any Supabase/Next.js concern so it's trivially unit-testable.
 */

/** A leading =, +, -, or @ is how spreadsheet formula injection works
 * (a cell opening with one of these is evaluated as a formula by Excel/
 * Sheets/LibreOffice when the file is opened) — prefixing with a single
 * quote neutralises it while leaving the value legible. */
const FORMULA_PREFIX = /^[=+\-@]/;

export function escapeCsvCell(value: string): string {
  const guarded = FORMULA_PREFIX.test(value) ? `'${value}` : value;
  if (!/[",\r\n]/.test(guarded)) return guarded;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function toCsvRow(cells: (string | number | null | undefined)[]): string {
  return cells.map((cell) => escapeCsvCell(cell === null || cell === undefined ? "" : String(cell))).join(",");
}

export interface CsvTable {
  headers: string[];
  rows: (string | number | null)[][];
}

/** This is a community-savings app, not a data warehouse — a fixed cap
 * with a visible truncation notice is a safer default than attempting
 * unbounded in-memory export. */
export const CSV_ROW_LIMIT = 10000;

export function toCsv(
  table: CsvTable,
  metadata: Record<string, string> = {},
): { csv: string; truncated: boolean; rowCount: number } {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(metadata)) {
    lines.push(toCsvRow([key, value]));
  }
  if (Object.keys(metadata).length > 0) lines.push("");

  lines.push(toCsvRow(table.headers));

  const truncated = table.rows.length > CSV_ROW_LIMIT;
  const rows = truncated ? table.rows.slice(0, CSV_ROW_LIMIT) : table.rows;
  for (const row of rows) lines.push(toCsvRow(row));

  if (truncated) {
    lines.push(toCsvRow([`Truncated at ${CSV_ROW_LIMIT} rows out of ${table.rows.length} total`]));
  }

  return { csv: lines.join("\r\n"), truncated, rowCount: rows.length };
}
