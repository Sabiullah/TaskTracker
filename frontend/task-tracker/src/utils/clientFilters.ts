import type { MasterItem } from "@/types";

const isActiveClient = (c: MasterItem): boolean => c.is_active !== false;

/** Drop inactive clients from a list destined for an Add-new picker. */
export function filterClientsForAdd(
  clients: readonly MasterItem[],
): MasterItem[] {
  return clients.filter(isActiveClient);
}

/** Drop inactive clients, but keep the currently-bound one even when
 *  inactive, so editing an existing row doesn't blank out its FK on
 *  save. Pass ``null`` for ``boundUid`` when no value is bound yet. */
export function filterClientsForEdit(
  clients: readonly MasterItem[],
  boundUid: string | null,
): MasterItem[] {
  return clients.filter(
    (c) => isActiveClient(c) || (boundUid !== null && c.id === boundUid),
  );
}

/** True when the client is inactive — callers can use this to append a
 *  "(inactive)" suffix in the rendered option label. */
export function isInactiveClient(c: MasterItem): boolean {
  return c.is_active === false;
}
