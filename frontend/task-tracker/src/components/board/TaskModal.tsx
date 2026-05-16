import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useMasters } from "@/hooks/useMasters";
import { useProfiles } from "@/hooks/useProfiles";
import { useAuth } from "@/hooks/useAuth";
import MainGoalFields from "./MainGoalFields";
import SubtaskTable from "./SubtaskTable";
import { hasSubErrors } from "./subtaskHelpers";
import {
  generateOccurrences,
  thisMonthString,
  monthsBetween,
  addMonthsToYearMonth,
} from "./recurrence";
import {
  addPlan,
  fetchTaskWithMonth,
  patchPlanRecurrence,
  patchSubtaskCascadeOwner,
  removePlan,
} from "@/lib/api/tasks";
import { apiDelete, ApiError } from "@/lib/api/client";
import {
  filterClientsForAdd,
  filterClientsForEdit,
} from "@/utils/clientFilters";
import type { OrgOption } from "./TaskFormFields";
import type { Task, SubtaskItem } from "@/types";
import type { MasterRecurrence, TaskDto } from "@/types/api";

/** One sub-category template, denormalised from the cat masters list so
 *  the occurrence engine has everything it needs in one place. ``uid``
 *  pins each row to the exact sub-cat master that produced it so a
 *  duplicate-name master under another parent can't be silently
 *  substituted in the save path. */
interface SubTemplate {
  uid: string;
  name: string;
  recurrence: MasterRecurrence;
  targetDay: number | null;
}

/** Plans store recurrence in the Task model's lowercase value space
 *  ("monthly"); the per-row dropdown speaks the MasterRecurrence space
 *  ("Monthly"). Map between them when reading plan → row. The reverse
 *  direction is the backend's job — sending "Monthly" to the PATCH
 *  endpoint is fine; the serializer normalises it. ``daily`` has no
 *  sub-cat UI yet; falling through to "" keeps the dropdown sane. */
const TASK_TO_MASTER_RECURRENCE: Record<string, MasterRecurrence> = {
  onetime: "Onetime",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  halfyearly: "Halfyearly",
  yearly: "Yearly",
};

/** "2026-05-15" → "Apr 2026". Used to suffix per-occurrence subtask
 *  descriptions so the user can distinguish 12 monthly rows at a glance.
 *  Returns the month BEFORE the target date because compliance work
 *  (GST returns, advance tax, etc.) is filed in month N for the period
 *  that closed in month N-1 — the description should reflect the period
 *  being worked on, not the filing date. The locale is fixed to ``en-US``
 *  so the format stays predictable for on-screen + DB consumers; date
 *  inputs themselves remain ISO. */
function previousMonthLabel(isoDate: string): string {
  if (!isoDate) return "";
  const m = /^(\d{4})-(\d{2})/.exec(isoDate);
  if (!m) return "";
  let year = parseInt(m[1], 10);
  let month = parseInt(m[2], 10) - 2; // -1 for 0-index, -1 for previous month
  if (month < 0) {
    month += 12;
    year -= 1;
  }
  const d = new Date(year, month, 1);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
  }).format(d);
}

/** Map a backend TaskDto (returned as the freshly-spawned child of a plan
 *  add) into the domain ``SubtaskItem`` shape the grid renders. Keep in
 *  sync with ``mappers.ts`` — this helper exists so the modal can splice
 *  the new row in without re-fetching the whole task. The ``plan`` arg
 *  carries the parent ``TaskSubcategoryPlan`` uid + recurrence so the
 *  spliced row supports per-row delete + recurrence change immediately,
 *  without waiting for a re-open of the modal. */
function dtoToTaskAsSub(
  dto: TaskDto,
  plan?: { uid: string; recurrence: string },
): SubtaskItem {
  return {
    id: dto.uid,
    description: dto.description,
    category: dto.category_detail?.name ?? "",
    subcategoryUid: dto.category ? String(dto.category) : null,
    responsible: dto.responsible_detail?.full_name ?? "",
    targetDate: dto.target_date ?? "",
    expectedDate: dto.expected_date ?? "",
    completedDate: dto.completed_date ?? "",
    remarks: dto.remarks ?? "",
    planUid: plan?.uid ?? null,
    recurrence: plan
      ? (TASK_TO_MASTER_RECURRENCE[plan.recurrence] ?? "")
      : (TASK_TO_MASTER_RECURRENCE[dto.recurrence] ?? ""),
  };
}

export interface TaskModalProps {
  task?: Partial<Task> | null;
  /** When opening from a sub-row, which sub uid to scroll to. */
  focusSubId?: string | null;
  /** Existing subs of the goal being edited (already loaded by caller). */
  initialSubs?: readonly SubtaskItem[];
  defaultStatus?: string;
  onSave: (
    main: Partial<Task> & { id?: string },
    subs: SubtaskItem[],
    plans?: Array<{
      subcategory_uid: string;
      default_owner_uid: string | null;
      recurrence: MasterRecurrence;
      target_day: number | null;
    }>,
  ) => void;
  onClose: () => void;
  onDelete?: (id: string) => void;
}

const EMPTY = {
  client: "", category: "", description: "", status: "Pending",
  targetDate: "", expectedDate: "", completedDate: "",
  responsible: "", reportingManager: "", remarks: "", recurrence: "Onetime", organization: "",
};

export default function TaskModal({
  task,
  focusSubId = null,
  initialSubs = [],
  defaultStatus,
  onSave,
  onClose,
  onDelete,
}: TaskModalProps) {
  const [form, setForm] = useState(EMPTY);
  const [subs, setSubs] = useState<SubtaskItem[]>([]);
  // Engagement window for the occurrence engine. ``startMonth`` is
  // ``YYYY-MM`` (matches ``<input type="month">``); ``engagementMonths``
  // is the number of months over which sub-templates materialise their
  // occurrences (e.g. 12 monthly + 4 quarterly + 1 yearly for a one-year
  // engagement starting in May 2026).
  const [startMonth, setStartMonth] = useState<string>(thisMonthString());
  const [engagementMonths, setEngagementMonths] = useState<number>(12);
  // The month being viewed in the subtask grid. Defaults to today's calendar
  // month. Past months render read-only.
  const [viewMonth, setViewMonth] = useState<string>(thisMonthString());

  const { orgs: myOrgs, profile, isAdminIn, isManagerIn } = useAuth();
  const orgs = useMemo<OrgOption[]>(
    () => myOrgs.map((o) => ({ uid: o.uid, name: o.name })),
    [myOrgs],
  );
  const viewerName = profile?.full_name ?? "";

  const { clients: clientMasters, cats: catMasters } = useMasters();
  const { profiles } = useProfiles();
  // Resolve the bound client's uid for Edit mode. The form stores the
  // client by *name* (legacy), so we look it up in clientMasters.
  const boundClientUid = useMemo(() => {
    if (!task) return null;
    const boundName = (task as { client_name?: string }).client_name ?? "";
    if (!boundName) return null;
    const match = clientMasters.find((c) => c.name === boundName);
    return match ? match.id : null;
  }, [task, clientMasters]);

  // Hide inactive clients on Add; on Edit, keep the bound (possibly
  // inactive) client so saving doesn't blank out the FK.
  const visibleClientMasters = useMemo(
    () =>
      task
        ? filterClientsForEdit(clientMasters, boundClientUid)
        : filterClientsForAdd(clientMasters),
    [clientMasters, task, boundClientUid],
  );

  const clientObjects = useMemo(
    () =>
      visibleClientMasters
        .map((c) => ({
          name: c.name,
          orgs: c.orgs && c.orgs.length ? c.orgs : c.org ? [c.org] : [],
          inactive: c.is_active === false,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [visibleClientMasters],
  );
  // Categories with a parent are sub-categories — they only show up in
  // the per-subtask dropdown, never in the goal-level "main category"
  // picker. Sub-categories are also used to auto-populate the subtask
  // grid when a user picks a main category.
  const mainCategories = useMemo(
    () =>
      [
        ...new Set(catMasters.filter((c) => !c.parent).map((c) => c.name)),
      ].sort((a, b) => a.localeCompare(b)),
    [catMasters],
  );
  const allCategories = useMemo(
    () => [...new Set(catMasters.map((c) => c.name))].sort((a, b) => a.localeCompare(b)),
    [catMasters],
  );
  // Map main-category UID → ordered list of child sub-category
  // templates. Keying by UID (not name) is critical: two main categories
  // can share a display name (e.g. one per org the user belongs to), and
  // each carries its own set of sub-cat masters with their own UIDs.
  // Pooling by name would emit subs from BOTH parents into the modal,
  // and the save would create plans for every duplicate — a goal under
  // "DB Update - Weekly" would silently materialise children for every
  // same-named master across orgs.
  const subTemplatesByMainUid = useMemo(() => {
    const map: Record<string, SubTemplate[]> = {};
    for (const c of catMasters) {
      if (!c.parent) continue;
      if (!map[c.parent]) map[c.parent] = [];
      map[c.parent].push({
        uid: String(c.id),
        name: c.name,
        recurrence: (c.recurrence ?? "") as MasterRecurrence,
        targetDay: c.target_day ?? null,
      });
    }
    Object.values(map).forEach((arr) =>
      arr.sort((a, b) => a.name.localeCompare(b.name)),
    );
    return map;
  }, [catMasters]);
  // Resolve the form's selected main category name to a single UID. When
  // multiple main categories share a display name, pick the first match
  // — same deterministic rule the caller already uses in
  // ``categoryUidByName`` so save / preview agree on which parent's
  // subs to use.
  const selectedMainUid = useMemo(() => {
    if (!form.category) return null;
    const match = catMasters.find((c) => c.name === form.category && !c.parent);
    return match ? String(match.id) : null;
  }, [form.category, catMasters]);
  // Names-only view used for the SubtaskTable category dropdown filter,
  // scoped to the currently-selected main category's UID.
  const subCategoriesForSelectedMain = useMemo<readonly string[]>(() => {
    if (!selectedMainUid) return [];
    const tpl = subTemplatesByMainUid[selectedMainUid] ?? [];
    return tpl.map((t) => t.name);
  }, [subTemplatesByMainUid, selectedMainUid]);
  const members = useMemo(() => {
    const matchOrg = form.organization;
    const names = profiles
      .filter((p) => (matchOrg ? p.orgs.some((o) => o.uid === matchOrg) : true))
      .map((p) => p.full_name)
      .filter(Boolean);
    return [...new Set(names)].sort((a, b) => a.localeCompare(b));
  }, [profiles, form.organization]);
  const filteredClients = useMemo(() => {
    const all = clientObjects.map((c) => ({ name: c.name, inactive: c.inactive }));
    if (!form.organization) return all;
    const filtered = clientObjects
      .filter((c) => c.orgs.includes(form.organization))
      .map((c) => ({ name: c.name, inactive: c.inactive }));
    return filtered.length ? filtered : all;
  }, [clientObjects, form.organization]);

  const availableMonths = useMemo(() => {
    const formAny = form as Partial<Task>;
    const start = (task as Partial<Task>)?.engagement_start
      || formAny.engagement_start
      || startMonth + "-01";
    const end = (task as Partial<Task>)?.engagement_end
      || formAny.engagement_end
      || addMonthsToYearMonth(startMonth, engagementMonths - 1) + "-01";
    const startMonthStr = String(start).slice(0, 7);
    const endMonthStr = String(end).slice(0, 7);
    const months = monthsBetween(startMonthStr, endMonthStr);
    const today = thisMonthString();
    if (!months.includes(today)) months.push(today);
    return [...new Set(months)].sort();
  }, [task, form, startMonth, engagementMonths]);

  useEffect(() => {
    const next = task
      ? { ...EMPTY, ...(task as object) }
      : { ...EMPTY, status: defaultStatus ?? "Pending" };
    // Defer the state set past the current render flush so React batches
    // it with the parent's update that triggered this effect.
    Promise.resolve().then(() => {
      setForm(next);
      setSubs([...initialSubs]);
    });
  }, [task, defaultStatus, initialSubs]);

  useEffect(() => {
    if (!task?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchTaskWithMonth(String(task.id), viewMonth);
        if (cancelled) return;
        const planByCat = new Map<
          string,
          { uid: string; recurrence: MasterRecurrence }
        >();
        for (const p of data.plans ?? []) {
          // Plan recurrence on the wire is the Task model's lowercase value
          // ("monthly"). Map it to the MasterRecurrence space the column
          // dropdown speaks so the per-row override round-trips cleanly.
          planByCat.set(String(p.subcategory), {
            uid: p.uid,
            recurrence: TASK_TO_MASTER_RECURRENCE[p.recurrence] ?? "",
          });
        }
        const monthSubs: SubtaskItem[] = (data.subtasks ?? []).map((dto) => {
          const planInfo = dto.category
            ? planByCat.get(String(dto.category))
            : undefined;
          return {
            id: dto.uid,
            description: dto.description,
            category: dto.category_detail?.name ?? "",
            // Keep the row pinned to the exact sub-cat master the child
            // was created under so save / recurrence-change paths never
            // re-resolve by name and accidentally pick a twin.
            subcategoryUid: dto.category ? String(dto.category) : null,
            responsible: dto.responsible_detail?.full_name ?? "",
            targetDate: dto.target_date ?? "",
            expectedDate: dto.expected_date ?? "",
            completedDate: dto.completed_date ?? "",
            remarks: dto.remarks ?? "",
            planUid: planInfo?.uid ?? null,
            recurrence: planInfo?.recurrence ?? "",
          };
        });
        setSubs(monthSubs);
      } catch (err) {
        console.error("Failed to load month subs", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [task?.id, viewMonth]);

  const flashedFor = useRef<string | null>(null);

  // Auto-scroll a sub row into view when opened from a sub click
  useEffect(() => {
    if (!focusSubId) return;
    if (flashedFor.current === focusSubId) return;
    const el = document.querySelector(`[data-sub-uid="${focusSubId}"]`);
    if (!el) return;
    flashedFor.current = focusSubId;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("sub-flash");
    window.setTimeout(() => el.classList.remove("sub-flash"), 1500);
  }, [focusSubId, subs.length]);

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const handleOrgChange = (newOrgUid: string) => {
    set("organization", newOrgUid);
    if (newOrgUid && form.client) {
      const obj = clientObjects.find((c) => c.name === form.client);
      if (obj?.orgs.length && !obj.orgs.includes(newOrgUid)) set("client", "");
    }
  };

  const handleClientChange = (clientName: string) => {
    set("client", clientName);
    if (clientName && !form.organization) {
      const obj = clientObjects.find((c) => c.name === clientName);
      const firstOrgUid = obj?.orgs?.[0];
      if (firstOrgUid) set("organization", firstOrgUid);
    }
  };

  const isCreate = !task;
  const subsHaveErrors = hasSubErrors(subs, form.targetDate);

  // Per-org role for the goal being edited. Falls back to "any-org" admin/
  // manager so a brand-new goal (no org chosen yet) doesn't lock the user
  // out of editing the rows they just added. Declared before the template
  // helpers below so the React Compiler can preserve its memoization —
  // the helpers close over ``canManageAll`` to seed the responsible
  // column.
  const canManageAll = useMemo(() => {
    if (form.organization) {
      return isAdminIn(form.organization) || isManagerIn(form.organization);
    }
    return myOrgs.some((o) => o.role === "admin" || o.role === "manager");
  }, [form.organization, isAdminIn, isManagerIn, myOrgs]);

  // Add-plan handler (Edit mode only). Pops a new plan onto the parent
  // goal for the chosen sub-category and the currently-viewed month. The
  // backend may return a freshly-spawned child task — when it does we
  // splice the row into the grid so the user sees their pick immediately
  // without a full refetch (Task 19 wires up the planUid round-trip).
  const handleAddPlan = useCallback(
    async (subCategoryName: string) => {
      if (!task?.id) return;
      // Resolve the picked sub-cat NAME to a UID under the goal's main
      // category specifically — without this filter the lookup could
      // return a same-named sub-cat under a different parent (e.g.
      // "Stock Report" exists under two main categories), silently
      // attaching the wrong plan to the goal.
      const subCat = catMasters.find(
        (c) =>
          c.name === subCategoryName &&
          c.parent &&
          (selectedMainUid ? String(c.parent) === selectedMainUid : true),
      );
      if (!subCat) return;
      try {
        const result = await addPlan(String(task.id), {
          subcategory: String(subCat.id),
          month: viewMonth,
        });
        if (result.child) {
          // Thread the plan uid + recurrence through so the new row supports
          // per-row delete / recurrence change without a modal reopen.
          setSubs((prev) => [
            ...prev,
            dtoToTaskAsSub(result.child!, {
              uid: result.plan.uid,
              recurrence: result.plan.recurrence,
            }),
          ]);
        }
      } catch (err) {
        alert(`Add failed: ${String(err)}`);
      }
    },
    [task, catMasters, viewMonth, selectedMainUid],
  );

  // Remove-plan handler (Edit mode only). Caps the active plan at the
  // current view month so past months stay intact and future months
  // stop generating. Falls back to a local splice for un-saved rows, and
  // — for legacy goals that have no ``TaskSubcategoryPlan`` row backing
  // the subtask — to a direct ``DELETE /api/tasks/<uid>/`` so the user can
  // still drop the row instead of being stuck on the "Plan not found" alert.
  const handleRemovePlan = useCallback(
    async (childUid: string, subCatName: string) => {
      if (!task?.id) {
        setSubs((prev) => prev.filter((s) => s.id !== childUid));
        return;
      }
      const row = subs.find((s) => s.id === childUid);
      const planUid = row?.planUid;
      if (!planUid) {
        // Legacy goal path: no plan record exists, so cap-by-month has
        // nothing to cap. Delete just this materialised child row — the
        // server broadcasts a tasks:DELETE so connected clients update too.
        const ok = window.confirm(
          `Remove "${subCatName}" from this goal? (This row has no recurring plan — only this subtask will be deleted.)`,
        );
        if (!ok) return;
        try {
          await apiDelete(`/tasks/${childUid}/`);
          setSubs((prev) => prev.filter((s) => s.id !== childUid));
        } catch (err) {
          // Already gone server-side (parallel deleter, stale state) →
          // drop locally so the row disappears instead of leaving the
          // user stuck retrying.
          if (err instanceof ApiError && err.status === 404) {
            setSubs((prev) => prev.filter((s) => s.id !== childUid));
            return;
          }
          alert(`Remove failed: ${String(err)}`);
        }
        return;
      }
      const ok = window.confirm(
        `Remove "${subCatName}" from this goal starting ${viewMonth}? Past months stay; future months won't generate.`,
      );
      if (!ok) return;
      try {
        await removePlan(String(task.id), planUid, viewMonth);
        setSubs((prev) => prev.filter((s) => s.id !== childUid));
      } catch (err) {
        alert(`Remove failed: ${String(err)}`);
      }
    },
    [task, viewMonth, subs],
  );

  // Recurrence-change handler (Edit mode only). Looks up the plan that
  // produced ``childUid`` and PATCHes its recurrence with the current view
  // month as the cap-point — past months stay as they were, future open
  // months are deleted and re-materialised on the new cadence. The grid
  // then refetches the current month so the user sees the result. Sends
  // the master's CURRENT target_day along with the new recurrence so a
  // stale plan (e.g. Onetime+5 left over from a previous master config)
  // resyncs to the master's current cadence in one PATCH.
  const handleRecurrenceChange = useCallback(
    async (childUid: string, newRecurrence: MasterRecurrence) => {
      if (!task?.id) return;
      const row = subs.find((s) => s.id === childUid);
      const planUid = row?.planUid;
      if (!planUid) {
        alert(
          "Plan not found for this row. Reopen the goal so plans load before changing recurrence.",
        );
        return;
      }
      if (row?.recurrence === newRecurrence) return;
      const ok = window.confirm(
        `Change "${row?.category || "this subtask"}" recurrence to ` +
          `${newRecurrence || "—"} starting ${viewMonth}?\n\n` +
          "Past months stay; future open occurrences will be regenerated.",
      );
      if (!ok) return;
      // Read the master's current target_day so the plan resyncs to the
      // current cadence rather than reusing a stale one (e.g. Weekly + 5
      // would emit every Friday instead of Monday). Prefer the row's
      // pinned ``subcategoryUid`` (correct even when the goal's main has
      // a same-named twin under another parent); fall back to name +
      // parent filter when the row was loaded without it.
      let subCat = row?.subcategoryUid
        ? catMasters.find((c) => String(c.id) === String(row.subcategoryUid))
        : undefined;
      if (!subCat && row?.category) {
        subCat = catMasters.find(
          (c) =>
            c.name === row.category &&
            c.parent &&
            (selectedMainUid ? String(c.parent) === selectedMainUid : true),
        );
      }
      const newTargetDay = subCat?.target_day ?? null;
      try {
        await patchPlanRecurrence(
          String(task.id),
          planUid,
          viewMonth,
          newRecurrence,
          newTargetDay,
        );
        // Easiest correct refresh: re-fetch the current view month so the
        // grid reflects the newly-materialised rows. Reuses the same loader
        // path the modal already runs on mount + month change.
        const data = await fetchTaskWithMonth(String(task.id), viewMonth);
        const planByCat = new Map<
          string,
          { uid: string; recurrence: MasterRecurrence }
        >();
        for (const p of data.plans ?? []) {
          planByCat.set(String(p.subcategory), {
            uid: p.uid,
            recurrence: TASK_TO_MASTER_RECURRENCE[p.recurrence] ?? "",
          });
        }
        setSubs(
          (data.subtasks ?? []).map((dto) => {
            const info = dto.category
              ? planByCat.get(String(dto.category))
              : undefined;
            return {
              id: dto.uid,
              description: dto.description,
              category: dto.category_detail?.name ?? "",
              subcategoryUid: dto.category ? String(dto.category) : null,
              responsible: dto.responsible_detail?.full_name ?? "",
              targetDate: dto.target_date ?? "",
              expectedDate: dto.expected_date ?? "",
              completedDate: dto.completed_date ?? "",
              remarks: dto.remarks ?? "",
              planUid: info?.uid ?? null,
              recurrence: info?.recurrence ?? "",
            };
          }),
        );
      } catch (err) {
        alert(`Recurrence change failed: ${String(err)}`);
      }
    },
    [task, subs, viewMonth, catMasters, selectedMainUid],
  );

  // Owner-change handler (Edit mode only). PATCHes the directly-edited
  // child with ?cascade_owner=true so the backend rewrites every same-
  // plan sibling whose target_date is on or after the edited row's. The
  // optimistic state mirrors that rule so the grid updates instantly.
  const handleOwnerChange = useCallback(
    async (childUid: string, newOwnerName: string) => {
      const owner = profiles.find((p) => p.full_name === newOwnerName);
      if (!owner) return;
      try {
        await patchSubtaskCascadeOwner(childUid, String(owner.id));
        setSubs((prev) =>
          prev.map((s) => {
            if (!s.targetDate) return s;
            const target = prev.find((p) => p.id === childUid);
            if (!target) return s;
            if (s.id === childUid) return { ...s, responsible: newOwnerName };
            // Same plan (same sub-cat) and later target → cascade.
            if (
              s.category === target.category &&
              target.targetDate &&
              s.targetDate > target.targetDate
            ) {
              return { ...s, responsible: newOwnerName };
            }
            return s;
          }),
        );
      } catch (err) {
        alert(`Owner change failed: ${String(err)}`);
      }
    },
    [profiles],
  );

  // Materialise subtask rows for one main category. For each child sub-
  // category we ask the occurrence engine for the list of target dates
  // inside ``[startMonth, startMonth + engagementMonths)`` and emit one
  // row per date. When the sub has no recurrence configured (legacy /
  // empty template) the engine returns a single row with a blank target
  // — same shape as before, no surprise behaviour change.
  //
  // Description gets a "— MMM YYYY" suffix (one month BEFORE the target
  // date — the period being worked on, not the filing month) when there
  // are multiple occurrences so the rows are distinguishable in the grid;
  // one-off rows keep just the sub-category name.
  const buildSubsFromTemplate = (
    mainUid: string | null,
    startMonthArg: string,
    engagementMonthsArg: number,
  ): SubtaskItem[] => {
    if (!mainUid) return [];
    const templates = subTemplatesByMainUid[mainUid] ?? [];
    if (templates.length === 0) return [];
    const out: SubtaskItem[] = [];
    for (const t of templates) {
      const dates = generateOccurrences({
        recurrence: t.recurrence,
        targetDay: t.targetDay,
        startMonth: startMonthArg,
        engagementMonths: engagementMonthsArg,
      });
      // Empty array can only happen when ``startMonth`` is malformed —
      // emit a single blank-target row so the user can still edit.
      const safeDates = dates.length === 0 ? [""] : dates;
      const multi = safeDates.length > 1;
      for (const d of safeDates) {
        const desc =
          multi && d ? `${t.name} — ${previousMonthLabel(d)}` : t.name;
        out.push({
          id: null,
          description: desc,
          category: t.name,
          // Pin each row to the exact sub-cat master that produced it so
          // the save path never has to guess between same-named masters
          // under different parents.
          subcategoryUid: t.uid,
          responsible: canManageAll ? "" : viewerName,
          targetDate: d,
          expectedDate: "",
          completedDate: "",
          remarks: "",
          recurrence: t.recurrence,
        });
      }
    }
    return out;
  };

  // Push the goal-level ``targetDate`` out to the latest subtask target
  // so the existing "sub date can't exceed main" validation doesn't trip
  // when the engine generates rows that span the engagement window. Only
  // expands the date — if the user already entered a later target it
  // stays.
  const stretchMainTarget = (newRows: readonly SubtaskItem[]): void => {
    const latest = newRows
      .map((r) => r.targetDate)
      .filter(Boolean)
      .sort()
      .pop();
    if (!latest) return;
    setForm((f) => ({
      ...f,
      targetDate: f.targetDate && f.targetDate > latest ? f.targetDate : latest,
    }));
  };

  const handleCategoryChange = (next: string) => {
    set("category", next);
    if (!next) return;
    // Resolve the picked NAME to a single parent UID synchronously so
    // we hit the right ``subTemplatesByMainUid`` bucket (the
    // ``selectedMainUid`` memo hasn't observed the new value yet).
    const nextMain = catMasters.find((c) => c.name === next && !c.parent);
    const nextMainUid = nextMain ? String(nextMain.id) : null;
    if (!nextMainUid) return;
    const templates = subTemplatesByMainUid[nextMainUid] ?? [];
    if (templates.length === 0) return;
    // "Empty" rows are blank placeholders the user hasn't touched yet —
    // safe to overwrite. Real rows have a description, are saved (have an
    // id), or were edited (responsible / dates set). When all current
    // subs are empty we silently load the template; otherwise we ask
    // before appending so the user doesn't lose their work.
    const isEmpty = (s: SubtaskItem) =>
      !s.id &&
      !s.description.trim() &&
      !s.category &&
      !s.responsible &&
      !s.targetDate &&
      !s.expectedDate &&
      !s.completedDate &&
      !s.remarks?.trim();
    const realSubs = subs.filter((s) => !isEmpty(s));
    const newRows = buildSubsFromTemplate(nextMainUid, startMonth, engagementMonths);
    if (realSubs.length === 0) {
      setSubs(newRows);
      stretchMainTarget(newRows);
      return;
    }
    const ok = window.confirm(
      `Load ${newRows.length} subtask occurrence(s) from "${next}"?\n\nExisting subtasks will be kept and the template appended below them.`,
    );
    if (!ok) return;
    setSubs([...realSubs, ...newRows]);
    stretchMainTarget(newRows);
  };

  // Re-materialise the grid when the user tweaks Start Month or
  // Engagement Months after picking a main category. Confirms before
  // overwriting any row that already has user-entered content.
  const regenerateFromTemplate = (
    nextStart: string,
    nextLength: number,
  ): void => {
    if (!selectedMainUid) return;
    const templates = subTemplatesByMainUid[selectedMainUid] ?? [];
    if (templates.length === 0) return;
    const isEmpty = (s: SubtaskItem) =>
      !s.id &&
      !s.description.trim() &&
      !s.category &&
      !s.responsible &&
      !s.targetDate &&
      !s.expectedDate &&
      !s.completedDate &&
      !s.remarks?.trim();
    const realSubs = subs.filter((s) => !isEmpty(s));
    const newRows = buildSubsFromTemplate(
      selectedMainUid,
      nextStart,
      nextLength,
    );
    if (realSubs.length === 0) {
      setSubs(newRows);
      stretchMainTarget(newRows);
      return;
    }
    const ok = window.confirm(
      `Replace ${realSubs.length} existing subtask(s) with ${newRows.length} fresh occurrence(s) from "${form.category}"?\n\nClick Cancel to keep them and append the new rows instead.`,
    );
    setSubs(ok ? newRows : [...realSubs, ...newRows]);
    stretchMainTarget(newRows);
  };

  const showEngagementPanel =
    !!selectedMainUid &&
    (subTemplatesByMainUid[selectedMainUid] ?? []).some(
      (t) => t.recurrence && t.recurrence !== "Onetime",
    );

  const openSubCount = useMemo(
    () => subs.filter((s) => !s.completedDate).length,
    [subs],
  );

  const buildPlansPayload = (rows: readonly SubtaskItem[]): Array<{
    subcategory_uid: string;
    default_owner_uid: string | null;
    recurrence: MasterRecurrence;
    target_day: number | null;
  }> => {
    const seen = new Set<string>();
    const out: Array<{
      subcategory_uid: string;
      default_owner_uid: string | null;
      recurrence: MasterRecurrence;
      target_day: number | null;
    }> = [];
    for (const row of rows) {
      // Prefer the row's pinned sub-cat UID (set when the row was built
      // from a template). Fall back to a name+parent lookup for legacy
      // rows the user added before this field existed — and even then,
      // restrict the lookup to the chosen main category so same-named
      // sub-cats under another parent can't be silently substituted.
      let subUid = row.subcategoryUid ? String(row.subcategoryUid) : null;
      if (!subUid && row.category) {
        const subCat = catMasters.find(
          (c) =>
            c.name === row.category &&
            c.parent &&
            (selectedMainUid ? String(c.parent) === selectedMainUid : true),
        );
        subUid = subCat ? String(subCat.id) : null;
      }
      if (!subUid) continue;
      if (seen.has(subUid)) continue;
      seen.add(subUid);
      const subCat = catMasters.find((c) => String(c.id) === subUid);
      if (!subCat) continue;
      const owner = profiles.find((p) => p.full_name === row.responsible);
      // Always send the master's CURRENT recurrence + target_day so the
      // plan reflects the user's latest configuration. Falling back to
      // `row.recurrence` was unsafe when the row was built from a stale
      // template — and falling back to the backend's "empty → monthly"
      // default would silently emit day-1-of-month children for masters
      // that the user just changed to Weekly.
      out.push({
        subcategory_uid: subUid,
        default_owner_uid: owner ? String(owner.id) : null,
        recurrence: (subCat.recurrence ?? "") as MasterRecurrence,
        target_day: subCat.target_day ?? null,
      });
    }
    return out;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.description.trim()) {
      alert("Please enter a task description.");
      return;
    }
    if (isCreate && !form.reportingManager) {
      alert("Please select a Reporting Manager.");
      return;
    }
    if (subsHaveErrors) {
      alert("Please fix the highlighted sub-task date errors before saving.");
      return;
    }
    if (form.completedDate && openSubCount > 0) {
      alert(
        `Cannot complete the main goal — ${openSubCount} sub-task(s) are still open. Complete every sub-task before marking the goal complete.`,
      );
      return;
    }
    const plansPayload = isCreate
      ? buildPlansPayload(
          subs.filter((s) => s.targetDate?.startsWith(viewMonth))
        )
      : undefined;
    const engStart = `${startMonth}-01`;
    const engEnd = `${addMonthsToYearMonth(startMonth, engagementMonths - 1)}-01`;
    onSave(
      {
        ...form,
        id: task?.id,
        engagement_start: engStart,
        engagement_end: engEnd,
      } as Partial<Task> & { id?: string },
      subs,
      plansPayload,
    );
  };

  const headerLabel = task ? `Edit Goal #${task.serialNo ?? ""}` : "Add New Task";

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">{headerLabel}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <MainGoalFields
            form={form}
            orgs={orgs}
            filteredClients={filteredClients}
            categories={mainCategories}
            members={members}
            clientObjects={clientObjects}
            set={(k, v) => {
              // Intercept goal-category changes so we can auto-populate
              // the subtask grid from the chosen main category's
              // children. Every other field flows through unchanged.
              if (k === "category" && typeof v === "string") {
                handleCategoryChange(v);
                return;
              }
              set(k, v);
            }}
            onOrgChange={handleOrgChange}
            onClientChange={handleClientChange}
            isCreate={isCreate}
          />

          {showEngagementPanel && (
            <div
              style={{
                margin: "8px 0",
                padding: "10px 12px",
                background: "#f1f5f9",
                border: "1px solid #cbd5e1",
                borderRadius: 6,
                display: "flex",
                gap: 14,
                alignItems: "center",
                flexWrap: "wrap",
                fontSize: 12,
              }}
            >
              <strong style={{ color: "#1e293b" }}>📅 Engagement</strong>
              <label
                style={{ display: "flex", gap: 6, alignItems: "center" }}
              >
                <span style={{ color: "#475569", fontWeight: 600 }}>
                  Start month
                </span>
                <input
                  type="month"
                  value={startMonth}
                  onChange={(e) => {
                    setStartMonth(e.target.value);
                    regenerateFromTemplate(e.target.value, engagementMonths);
                  }}
                  style={{
                    padding: "4px 8px",
                    border: "1px solid #cbd5e1",
                    borderRadius: 4,
                    fontSize: 12,
                  }}
                />
              </label>
              <label
                style={{ display: "flex", gap: 6, alignItems: "center" }}
              >
                <span style={{ color: "#475569", fontWeight: 600 }}>
                  Length (months)
                </span>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={engagementMonths}
                  onChange={(e) => {
                    const v = Math.max(
                      1,
                      Math.min(60, Number(e.target.value) || 1),
                    );
                    setEngagementMonths(v);
                    regenerateFromTemplate(startMonth, v);
                  }}
                  style={{
                    padding: "4px 8px",
                    border: "1px solid #cbd5e1",
                    borderRadius: 4,
                    fontSize: 12,
                    width: 70,
                  }}
                />
              </label>
              <span style={{ color: "#64748b", fontSize: 11 }}>
                Subtasks regenerate from each sub-category&apos;s
                recurrence + target day. Edit rows freely below.
              </span>
            </div>
          )}

          <div
            style={{
              margin: "8px 0",
              display: "flex",
              gap: 12,
              alignItems: "center",
              fontSize: 13,
            }}
          >
            <label style={{ fontWeight: 600 }}>Month:</label>
            <select
              value={viewMonth}
              onChange={(e) => setViewMonth(e.target.value)}
              style={{
                padding: "4px 8px",
                border: "1px solid #cbd5e1",
                borderRadius: 4,
              }}
            >
              {availableMonths.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <span style={{ color: "#64748b", fontSize: 11 }}>
              {viewMonth < thisMonthString()
                ? "Read-only — past months are history."
                : "Edits cascade forward to following months."}
            </span>
          </div>

          <SubtaskTable
            subs={subs.filter((s) =>
              s.targetDate ? s.targetDate.startsWith(viewMonth) : false
            )}
            categories={
              // Prefer the chosen main category's children; fall back to
              // every category so legacy goals (no parent links) and
              // un-categorised goals still get a useful dropdown. Always
              // appended to the row's current value so a sub keeps its
              // existing label even if it isn't a child of the new main.
              subCategoriesForSelectedMain.length > 0
                ? subCategoriesForSelectedMain
                : allCategories
            }
            members={members}
            mainTargetDate={form.targetDate}
            viewerName={viewerName}
            canManageAll={canManageAll}
            onChange={setSubs}
            readOnly={viewMonth < thisMonthString()}
            onAdd={task ? handleAddPlan : undefined}
            onRemove={task ? handleRemovePlan : undefined}
            onOwnerChange={task ? handleOwnerChange : undefined}
            onRecurrenceChange={task ? handleRecurrenceChange : undefined}
            defaultTargetDate={viewMonth ? `${viewMonth}-01` : ""}
          />

          {form.completedDate && openSubCount > 0 && (
            <div
              style={{
                margin: "8px 0",
                padding: "8px 12px",
                background: "#fef3c7",
                border: "1px solid #f59e0b",
                color: "#92400e",
                borderRadius: 6,
                fontSize: 12,
              }}
            >
              ⚠ Main goal cannot be marked complete while {openSubCount} sub-task(s) are still open.
            </div>
          )}

          <div className="modal-foot">
            <div className="modal-foot-left">
              {task && (
                <span style={{ fontSize: 11, color: "var(--txt3)" }}>
                  Task #{task.serialNo}
                </span>
              )}
            </div>
            {task && onDelete && (
              <button
                type="button" className="btn"
                style={{ background: "#fee2e2", color: "#dc2626", border: "1px solid #fca5a5", marginRight: "auto" }}
                onClick={() => {
                  const subCount = subs.length;
                  const msg = subCount > 0
                    ? `Delete this goal and its ${subCount} sub-task(s)? This cannot be undone.`
                    : "Delete this task? This cannot be undone.";
                  if (window.confirm(msg)) {
                    onDelete(task.id!);
                    onClose();
                  }
                }}
              >
                🗑 Delete
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={subsHaveErrors || (!!form.completedDate && openSubCount > 0)}
            >
              {task ? "✓ Save Goal" : "+ Add Task"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
