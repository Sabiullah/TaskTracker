import { ApiError } from "@/lib/api";

/**
 * Surface an API failure to the user via `alert()`.
 *
 * Centralised so the two Client tabs (Road Map, MOM) share a consistent
 * shape. We match the existing `useMasters.saveItem` style rather than
 * introducing a toast library. `ApiError` carries the server's parsed
 * response body — include it so validation errors (field-level) are
 * visible without opening devtools.
 */
export function reportApiError(prefix: string, err: unknown): void {
  if (err instanceof ApiError) {
    const bodyMsg =
      typeof err.body === "object" && err.body
        ? JSON.stringify(err.body)
        : String(err.body);
    alert(`${prefix} (${err.status}): ${err.message}\n${bodyMsg}`);
  } else {
    alert(`${prefix}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
