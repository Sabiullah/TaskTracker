import { useState, useEffect, useMemo } from "react";
import { useMasters } from "@/hooks/useMasters";
import { useAuth } from "@/hooks/useAuth";
import TaskFormFields from "./TaskFormFields";
import type { OrgOption } from "./TaskFormFields";
import type { Task } from "@/types";

export interface TaskModalProps {
  task?: Partial<Task> | null;
  defaultStatus?: string;
  onSave: (task: Partial<Task> & { id?: string }) => void;
  onClose: () => void;
  onDelete?: (id: string) => void;
}

const EMPTY = {
  client: "", category: "", description: "", status: "Pending",
  targetDate: "", expectedDate: "", completedDate: "",
  responsible: "", remarks: "", recurrence: "Onetime", organization: "",
};

export default function TaskModal({ task, defaultStatus, onSave, onClose, onDelete }: TaskModalProps) {
  const [form, setForm] = useState(EMPTY);

  // Org list: signed-in user's memberships from AuthContext. Masters
  // (clients/categories/team) come from the API hook — no localStorage
  // cache, so the uid/name shape is consistent on first paint.
  const { orgs: myOrgs } = useAuth();
  const orgs = useMemo<OrgOption[]>(
    () => myOrgs.map((o) => ({ uid: o.uid, name: o.name })),
    [myOrgs],
  );

  const { clients: clientMasters, cats: catMasters, team: teamMasters } = useMasters();
  const clientObjects = useMemo(
    () =>
      clientMasters
        .map((c) => ({ name: c.name, orgs: c.org ? [c.org] : [] }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [clientMasters],
  );
  const categories = useMemo(
    () =>
      [...new Set(catMasters.map((c) => c.name))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [catMasters],
  );
  const members = useMemo(
    () =>
      [...new Set(teamMasters.map((t) => t.name))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [teamMasters],
  );

  const filteredClients = useMemo(() => {
    const all = clientObjects.map((c) => c.name);
    if (!form.organization) return all;
    // ``clientObjects[].orgs`` is a list of org UIDs (from useMasters); the
    // form's ``organization`` is also a uid, so compare directly.
    const filtered = clientObjects
      .filter((c) => c.orgs.includes(form.organization))
      .map((c) => c.name);
    return filtered.length ? filtered : all;
  }, [clientObjects, form.organization]);

  useEffect(() => {
    const next = task
      ? { ...EMPTY, ...(task as object) }
      : { ...EMPTY, status: defaultStatus ?? "Pending" };
    Promise.resolve().then(() => setForm(next));
  }, [task, defaultStatus]);

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const handleOrgChange = (newOrgUid: string) => {
    set("organization", newOrgUid);
    if (newOrgUid && form.client) {
      const obj = clientObjects.find((c) => c.name === form.client);
      if (obj?.orgs.length && !obj.orgs.includes(newOrgUid)) {
        set("client", "");
      }
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.description.trim()) { alert("Please enter a task description."); return; }
    onSave({ ...form, id: task?.id } as Partial<Task> & { id?: string });
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">{task ? "Edit Task" : "Add New Task"}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <TaskFormFields
            form={form}
            orgs={orgs}
            filteredClients={filteredClients}
            categories={categories}
            members={members}
            clientObjects={clientObjects}
            set={set}
            onOrgChange={handleOrgChange}
            onClientChange={handleClientChange}
          />

          <div className="modal-foot">
            <div className="modal-foot-left">
              {task && <span style={{ fontSize: 11, color: "var(--txt3)" }}>Task #{task.serialNo}</span>}
            </div>
            {task && onDelete && (
              <button
                type="button" className="btn"
                style={{ background: "#fee2e2", color: "#dc2626", border: "1px solid #fca5a5", marginRight: "auto" }}
                onClick={() => { if (window.confirm("Delete this task? This cannot be undone.")) { onDelete((task as { id?: string }).id!); onClose(); } }}
              >
                🗑 Delete
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">{task ? "✓ Save Changes" : "+ Add Task"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
