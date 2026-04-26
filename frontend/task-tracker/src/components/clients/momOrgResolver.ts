import type { MasterItem } from "@/types";

/**
 * Resolve the org uid that owns a meeting being created/edited for the
 * given client. Multi-org admins must include `org` on POST so the
 * backend's `resolve_create_org` does not reject the write; on PATCH we
 * also send it so a client-change on edit moves the meeting to the new
 * client's owning org. Falls back to the legacy single `org` field, then
 * to the first entry of `orgs`, then `undefined` (which the backend
 * rejects with 400 — surfaced via reportApiError in the caller).
 */
export function orgUidForClient(
  clients: readonly MasterItem[],
  clientUid: string,
): string | undefined {
  const c = clients.find((x) => x.id === clientUid);
  return c?.org ?? c?.orgs?.[0] ?? undefined;
}
