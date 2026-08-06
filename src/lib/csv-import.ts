/**
 * Minimal CSV *parsing* (the inverse of src/lib/csv.ts's serialization-only
 * helpers). Handles quoted fields, escaped quotes, and commas/newlines
 * inside quotes — the same shape spreadsheet software actually exports,
 * without pulling in a dependency for it.
 */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // Normalize line endings up front so \r\n and \r don't produce
  // phantom blank rows or split a quoted field mid-way.
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];

    if (inQuotes) {
      if (char === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop fully blank trailing rows (a trailing newline in the file
  // otherwise produces a spurious empty row).
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

export interface CsvHeaderRow {
  headers: string[];
  rows: Record<string, string>[];
}

/**
 * Parses the first row as a header (case-insensitive, trimmed) and
 * returns each subsequent row as a plain object keyed by that header —
 * the shape every caller in this codebase actually wants, rather than
 * raw positional arrays.
 */
export function parseCsvWithHeader(text: string): CsvHeaderRow {
  const rows = parseCsv(text);
  if (rows.length === 0) return { headers: [], rows: [] };

  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const dataRows = rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, i) => {
      record[header] = (row[i] ?? "").trim();
    });
    return record;
  });

  return { headers, rows: dataRows };
}
