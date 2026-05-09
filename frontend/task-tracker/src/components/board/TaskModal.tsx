import { useState, useEffect, useMemo, useRef } from "react";
import { useMasters } from "@/hooks/useMasters";
import { useProfiles } from "@/hooks/useProfiles";
import { useAuth } from "@/hooks/useAuth";
import MainGoalFields from "./MainGoalFields";
import SubtaskTable from "./SubtaskTable";
import { hasSubErrors } from "./subtaskHelpers";
import type { OrgOption } from "./TaskFormFields";
import type { Task, SubtaskItem } from "@/types";

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

  const { orgs: myOrgs, profile, isAdminIn, isManagerIn } = useAuth();
  const orgs = useMemo<OrgOption[]>(
    () => myOrgs.map((o) => ({ uid: o.uid, name: o.name })),
    [myOrgs],
  );
  const viewerName = profile?.full_name ?? "";

  const { clients: clientMasters, cats: catMasters } = useMasters();
  const { profiles } = useProfiles();
  const clientObjects = useMemo(
    () =>
      clientMasters
        .map((c) => ({
          name: c.name,
          orgs: c.orgs && c.orgs.length ? c.orgs : c.org ? [c.org] : [],
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [clientMasters],
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
  // Map main-category name → ordered list of child sub-category names.
  // Cats are looked up by id (the FK) so renames on the parent flow
  // through automatically.
  const subCategoriesByMain = useMemo(() => {
    const idToName = new Map(catMasters.map((c) => [c.id, c.name]));
    const map: Record<string, string[]> = {};
    for (const c of catMasters) {
      if (!c.parent) continue;
      const parentName = idToName.get(c.parent);
      if (!parentName) continue;
      if (!map[parentName]) map[parentName] = [];
      map[parentName].push(c.name);
    }
    Object.values(map).forEach((arr) => arr.sort((a, b) => a.localeCompare(b)));
    return map;
  }, [catMasters]);
  const members = useMemo(() => {
    const matchOrg = form.organization;
    const names = profiles
      .filter((p) => (matchOrg ? p.orgs.some((o) => o.uid === matchOrg) : true))
      .map((p) => p.full_name)
      .filter(Boolean);
    return [...new Set(names)].sort((a, b) => a.localeCompare(b));
  }, [profiles, form.organization]);
  const filteredClients = useMemo(() => {
    const all = clientObjects.map((c) => c.name);
    if (!form.organization) return all;
    const filtered = clientObjects
      .filter((c) => c.orgs.includes(form.organization))
      .map((c) => c.name);
    return filtered.length ? filtered : all;
  }, [clientObjects, form.organization]);

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

  // Build subtask rows from the children of a main category. Each row's
  // ``description`` is seeded with the sub-category name so the user
  // immediately sees what each placeholder is for; they can edit before
  // saving.
  const buildSubsFromTemplate = (mainName: string): SubtaskItem[] => {
    const subNames = subCategoriesByMain[mainName] ?? [];
    return subNames.map((subName) => ({
      id: null,
      description: subName,
      category: subName,
      responsible: canManageAll ? "" : viewerName,
      targetDate: "",
      expectedDate: "",
      completedDate: "",
      remarks: "",
    }));
  };

  const handleCategoryChange = (next: string) => {
    set("category", next);
    if (!next) return;
    const subNames = subCategoriesByMain[next] ?? [];
    if (subNames.length === 0) return;
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
    if (realSubs.length === 0) {
      setSubs(buildSubsFromTemplate(next));
      return;
    }
    const ok = window.confirm(
      `Load ${subNames.length} default subtask(s) from "${next}"?\n\nExisting subtasks will be kept and the template appended below them.`,
    );
    if (!ok) return;
    setSubs([...realSubs, ...buildSubsFromTemplate(next)]);
  };

  const openSubCount = useMemo(
    () => subs.filter((s) => !s.completedDate).length,
    [subs],
  );

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
    onSave({ ...form, id: task?.id } as Partial<Task> & { id?: string }, subs);
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

          <SubtaskTable
            subs={subs}
            categories={
              // Prefer the chosen main category's children; fall back to
              // every category so legacy goals (no parent links) and
              // un-categorised goals still get a useful dropdown. Always
              // appended to the row's current value so a sub keeps its
              // existing label even if it isn't a child of the new main.
              form.category && subCategoriesByMain[form.category]?.length
                ? subCategoriesByMain[form.category]
                : allCategories
            }
            members={members}
            mainTargetDate={form.targetDate}
            viewerName={viewerName}
            canManageAll={canManageAll}
            onChange={setSubs}
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
