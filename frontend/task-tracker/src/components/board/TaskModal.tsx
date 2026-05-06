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
  const categories = useMemo(
    () => [...new Set(catMasters.map((c) => c.name))].sort((a, b) => a.localeCompare(b)),
    [catMasters],
  );
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
  // out of editing the rows they just added.
  const canManageAll = useMemo(() => {
    if (form.organization) {
      return isAdminIn(form.organization) || isManagerIn(form.organization);
    }
    return myOrgs.some((o) => o.role === "admin" || o.role === "manager");
  }, [form.organization, isAdminIn, isManagerIn, myOrgs]);

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
            categories={categories}
            members={members}
            clientObjects={clientObjects}
            set={set}
            onOrgChange={handleOrgChange}
            onClientChange={handleClientChange}
            isCreate={isCreate}
          />

          <SubtaskTable
            subs={subs}
            categories={categories}
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
