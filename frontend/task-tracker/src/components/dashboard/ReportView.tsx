import { useState, useMemo } from "react";
import {
  RECURRENCE_OPTIONS,
  computeStatus,
  getProjectedDate,
  hasRecurringInstance,
} from "@/utils/task";
import MultiSelect from "@/components/ui/MultiSelect";
import TaskDetailTable from "./TaskDetailTable";
import type { Task, Profile } from "@/types";

export interface ReportViewProps {
  tasks: Task[];
  /** Unfiltered task pool, forwarded to TaskDetailTable for parent lookup. */
  allTasks?: Task[];
  onBack: () => void;
  profile: Profile | null;
  onAddTask?: (() => void) | null;
}

export default function ReportView({
  tasks,
  allTasks,
  onBack,
  profile,
  onAddTask = null,
}: ReportViewProps) {
  const [fStatus, setFStatus] = useState<string[]>([]);
  const [fClient, setFClient] = useState<string[]>([]);
  const [fMember, setFMember] = useState<string[]>([]);
  const [fRecurrence, setFRecurrence] = useState<string[]>([]);
  const [fMonth, setFMonth] = useState("");
  const [sortField, setSortField] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const expandedTasks = useMemo(() => {
    const now = new Date();
    const result: (Task & { _rowKey: string })[] = [];
    tasks.forEach((t) => {
      const r = t.recurrence || "Onetime";
      if (r === "Onetime") {
        result.push({ ...t, _rowKey: t.id });
      } else {
        for (let offset = 0; offset <= 2; offset++) {
          const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
          const y = d.getFullYear();
          const mo = d.getMonth();
          if (!hasRecurringInstance(t, y, mo)) continue;
          const projectedDate = getProjectedDate(t, y, mo);
          const calMonth = `${y}-${String(mo + 1).padStart(2, "0")}`;
          const origMonth = (t.targetDate || "").slice(0, 7);
          // Wipe recurring fields only when this report column's cycle is
          // neither the row's stored month nor the month it was completed in —
          // otherwise a materialised child's real completion gets blanked and
          // shows Overdue (mirrors the DashboardPage projection fix).
          const otherCycle =
            origMonth !== calMonth &&
            (t.completedDate || "").slice(0, 7) !== calMonth;
          const proj = {
            ...t,
            targetDate: projectedDate,
            ...(otherCycle
              ? { expectedDate: "", completedDate: "", remarks: "" }
              : {}),
            _rowKey: `${t.id}-${calMonth}`,
          };
          proj.status = computeStatus(proj);
          result.push(proj);
        }
      }
    });
    return result;
  }, [tasks]);

  const statuses = [
    ...new Set(expandedTasks.map((t) => t.status).filter(Boolean)),
  ].sort();
  const clients = [
    ...new Set(expandedTasks.map((t) => t.client).filter(Boolean)),
  ].sort();
  const members = [
    ...new Set(expandedTasks.map((t) => t.responsible).filter(Boolean)),
  ].sort();
  const recOpts = (RECURRENCE_OPTIONS as Array<{ value: string }>).map(
    (r) => r.value,
  );
  const months = [
    ...new Set(
      expandedTasks
        .map((t) => (t.targetDate || "").slice(0, 7))
        .filter(Boolean),
    ),
  ]
    .sort()
    .reverse();

  const toggleSort = (field: string) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const filtered = useMemo(() => {
    let result = expandedTasks.filter(
      (t) =>
        (!fStatus.length || fStatus.includes(t.status)) &&
        (!fClient.length || fClient.includes(t.client)) &&
        (!fMember.length || fMember.includes(t.responsible)) &&
        (!fRecurrence.length ||
          fRecurrence.includes(t.recurrence || "Onetime")) &&
        (!fMonth || (t.targetDate || "").startsWith(fMonth)),
    );
    if (sortField) {
      result = [...result].sort((a, b) => {
        const av =
          sortField === "responsible"
            ? (a.responsible || "").toLowerCase()
            : a.targetDate || "";
        const bv =
          sortField === "responsible"
            ? (b.responsible || "").toLowerCase()
            : b.targetDate || "";
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    return result;
  }, [
    expandedTasks,
    fStatus,
    fClient,
    fMember,
    fRecurrence,
    fMonth,
    sortField,
    sortDir,
  ]);

  const hasFilter =
    fStatus.length ||
    fClient.length ||
    fMember.length ||
    fRecurrence.length ||
    fMonth;

  return (
    <div>
      <div
        className="wl-filter-bar"
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 14,
          padding: "12px",
          background: "#f8fafc",
          borderRadius: 8,
          alignItems: "flex-end",
        }}
      >
        <MultiSelect
          label="Status"
          options={statuses}
          selected={fStatus}
          onChange={setFStatus}
          allLabel="All Statuses"
        />
        <MultiSelect
          label="Client"
          options={clients}
          selected={fClient}
          onChange={setFClient}
          allLabel="All Clients"
        />
        <MultiSelect
          label="Member"
          options={members}
          selected={fMember}
          onChange={setFMember}
          allLabel="All Members"
        />
        <MultiSelect
          label="Recurrence"
          options={recOpts}
          selected={fRecurrence}
          onChange={setFRecurrence}
          allLabel="All Types"
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#475569" }}>
            MONTH (Target)
          </span>
          <select
            value={fMonth}
            onChange={(e) => setFMonth(e.target.value)}
            style={{
              padding: "6px 10px",
              border: `1.5px solid ${fMonth ? "#2563eb" : "#e2e8f0"}`,
              borderRadius: 6,
              fontSize: 12,
              background: fMonth ? "#eff6ff" : "#fff",
              fontWeight: fMonth ? 700 : 400,
              cursor: "pointer",
              minWidth: 120,
            }}
          >
            <option value="">All Months</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        {hasFilter ? (
          <button
            onClick={() => {
              setFStatus([]);
              setFClient([]);
              setFMember([]);
              setFRecurrence([]);
              setFMonth("");
            }}
            style={{
              padding: "6px 12px",
              border: "1px solid #e2e8f0",
              background: "#fff",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
              marginBottom: 2,
            }}
          >
            ✕ Clear All
          </button>
        ) : null}
      </div>

      <TaskDetailTable
        tasks={filtered as unknown as Task[]}
        allTasks={allTasks}
        title="📋 Full Task Report"
        onBack={onBack}
        filename="task-report.csv"
        editable={true}
        profile={profile}
        sortField={sortField}
        sortDir={sortDir}
        onSort={toggleSort}
        onAddTask={onAddTask}
      />
    </div>
  );
}
