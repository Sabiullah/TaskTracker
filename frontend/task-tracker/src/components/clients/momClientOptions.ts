import type { MasterItem } from "@/types";

/**
 * Compute the option list for the meeting modal's Client dropdown.
 *
 * - When `selectedOrg` is null, all clients are included.
 * - When `selectedOrg` is set, only clients whose `orgs` array contains it
 *   (or whose legacy `org` matches it as a fallback) are included.
 * - The currently-selected `clientUid` is always included if it matches a
 *   known client, even when the org filter would otherwise exclude it —
 *   this prevents React's "value not in <select> options" warning when the
 *   modal is opened with a default client outside the filter.
 * - When `excludeInactive` is true (the Add-modal context), clients with
 *   `is_active === false` are dropped — except the pinned `clientUid`,
 *   which is always retained.
 * - The result is sorted by name (ascending).
 */
export function momClientOptions(
  clients: readonly MasterItem[],
  selectedOrg: string | null,
  clientUid: string,
  excludeInactive: boolean = false,
): MasterItem[] {
  const matchesOrg = (c: MasterItem): boolean => {
    if (!selectedOrg) return true;
    if (c.orgs.includes(selectedOrg)) return true;
    return c.org === selectedOrg;
  };
  const isActive = (c: MasterItem): boolean => c.is_active !== false;

  const base = clients.filter(
    (c) => matchesOrg(c) && (!excludeInactive || isActive(c)),
  );
  const pinned =
    clientUid && !base.some((c) => c.id === clientUid)
      ? clients.filter((c) => c.id === clientUid)
      : [];
  return [...base, ...pinned].sort((a, b) => a.name.localeCompare(b.name));
}
