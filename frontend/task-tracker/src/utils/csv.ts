/**
 * Generic CSV export utility.
 * Derives column headers from the keys of the first row.
 * All values are escaped for CSV safety.
 */
export function exportCSV(
  rows: Record<string, unknown>[],
  filename: string,
): void {
  if (!rows.length) return;

  const esc = (v: unknown): string =>
    `"${String(v ?? "").replace(/"/g, '""')}"`;
  const headers = Object.keys(rows[0]);
  const csvRows = rows.map((row) => headers.map((h) => esc(row[h])).join(","));
  const csv = [headers.join(","), ...csvRows].join("\n");

  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), {
    href: url,
    download: filename,
  });
  a.click();
  URL.revokeObjectURL(url);
}
