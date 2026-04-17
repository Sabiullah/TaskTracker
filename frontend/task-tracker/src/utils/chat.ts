// ── Helpers ───────────────────────────────────────────────────────────────────
export const fmtSize = (b: number): string =>
  b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;

export const isImage = (t: string | null | undefined): boolean =>
  t?.startsWith("image/") ?? false;
