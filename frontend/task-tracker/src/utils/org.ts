/**
 * parseOrg — normalises an org field value to a string array.
 * Handles:
 *   - JSON array strings  e.g. '["YBV","4D"]'
 *   - plain strings       e.g. "YBV"  (legacy)
 *   - already-parsed arrays
 *   - null / undefined
 */
export function parseOrg(val: string | string[] | null | undefined): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try {
    const p = JSON.parse(val);
    if (Array.isArray(p)) return p;
  } catch {}
  return [val];
}

/**
 * serializeOrg — serialises an org array to a JSON string for storage.
 * Returns `null` (as string) when the array is empty so callers can
 * store a nullable column cleanly; callers that need a plain string
 * can coerce with `?? ''`.
 */
export function serializeOrg(orgs: string[]): string {
  return JSON.stringify(orgs);
}
