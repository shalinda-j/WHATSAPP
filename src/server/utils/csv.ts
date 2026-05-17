/**
 * Minimal RFC 4180 CSV serialiser. Used by the export endpoints so we
 * don't pull in a CSV dependency just for the four data shapes the
 * admin needs to download. Quoting rules:
 *   - Wrap a cell in "..." when it contains a quote, comma, newline,
 *     or carriage return.
 *   - Inside a quoted cell, replace " with "".
 *   - null / undefined → empty cell.
 *   - Dates → ISO-8601 (UTC) so Excel auto-formats them.
 */
export function toCsv(
  rows: Record<string, unknown>[],
  columns?: string[],
): string {
  if (rows.length === 0) {
    return columns?.length ? `${columns.join(',')}\n` : '';
  }
  const cols =
    columns && columns.length > 0
      ? columns
      : Array.from(
          new Set(rows.flatMap((r) => Object.keys(r))),
        );

  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    let s: string;
    if (v instanceof Date) s = v.toISOString();
    else if (typeof v === 'object') s = JSON.stringify(v);
    else s = String(v);
    if (/[",\n\r]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const header = cols.join(',');
  const body = rows.map((r) => cols.map((c) => escape(r[c])).join(','));
  return `${header}\n${body.join('\n')}\n`;
}

/**
 * Sets Content-Type + Content-Disposition for a CSV download with a
 * sanitised filename (replaces problematic characters so the response
 * header parses safely).
 */
export function csvDownloadHeaders(filename: string): Record<string, string> {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  return {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${safe}"`,
  };
}
