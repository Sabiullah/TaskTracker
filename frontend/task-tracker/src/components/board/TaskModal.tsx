import { useState, useEffect, useMemo } from "react";
import { getLiveOrgs, getLiveClientObjects, getLiveCategories, getLiveMembers } from "@/utils/masters";
import TaskFormFields from "./TaskFormFields";
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

  const orgs = useMemo(() => getLiveOrgs(), []);
  const clientObjects = useMemo(() => getLiveClientObjects(), []);
  const categories = useMemo(() => getLiveCategories(), []);
  const members = useMemo(() => getLiveMembers(), []);

  const filteredClients = useMemo(() => {
    const all = clientObjects.map((c) => c.name).sort((a, b) => a.localeCompare(b));
    if (!form.organization) return all;
    const filtered = clientObjects
      .filter((c) => c.orgs.includes(form.organization))
      .map((c) => c.name)
      .sort((a, b) => a.localeCompare(b));
    return filtered.length ? filtered : all;
  }, [clientObjects, form.organization]);

  useEffect(() => {
    const next = task
      ? { ...EMPTY, ...(task as object) }
      : { ...EMPTY, status: defaultStatus ?? "Pending" };
    Promise.resolve().then(() => setForm(next));
  }, [task, defaultStatus]);

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const handleOrgChange = (newOrg: string) => {
    set("organization", newOrg);
    if (newOrg && form.client) {
      const obj = clientObjects.find((c) => c.name === form.client);
      if (obj?.orgs.length && !obj.orgs.includes(newOrg)) set("client", "");
    }
  };

  const handleClientChange = (clientName: string) => {
    set("client", clientName);
    if (clientName && !form.organization) {
      const obj = clientObjects.find((c) => c.name === clientName);
      if (obj?.orgs?.length) set("organization", obj.orgs[0]);
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
