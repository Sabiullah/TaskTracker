import type { MasterItem } from "@/types";

/**
 * Resolve a picked sub-category display NAME to its category Master.
 *
 * The Edit-Goal "+ Add subtask" picker lists the selected main category's
 * child sub-categories, but falls back to listing ALL categories for goals
 * whose main has no child masters (legacy / un-categorised mains, or mains
 * like "Analytics" that simply have no sub-cats configured). A strict
 * "child of the selected main" lookup therefore returns nothing for those
 * fallback rows — which is why clicking a sub-category in the picker used
 * to silently do nothing. Resolve progressively so what the handler accepts
 * matches what the picker actually offers:
 *
 *   1. a child master under the selected main — avoids grabbing a same-named
 *      sub-cat that lives under a *different* parent (e.g. "Stock Report"
 *      exists under two mains),
 *   2. any child master with that name — the fallback-to-all-categories case,
 *   3. any master with that name at all — legacy goals where the picked
 *      label is itself a top-level (parentless) category.
 *
 * Returns ``undefined`` only when no category master matches the name; the
 * backend then has nothing to attach and the caller should surface an error.
 */
export function resolveSubCategoryMaster(
  catMasters: readonly MasterItem[],
  name: string,
  selectedMainUid: string | null,
): MasterItem | undefined {
  return (
    (selectedMainUid != null
      ? catMasters.find(
          (c) => c.name === name && c.parent && String(c.parent) === selectedMainUid,
        )
      : undefined) ??
    catMasters.find((c) => c.name === name && c.parent) ??
    catMasters.find((c) => c.name === name)
  );
}
