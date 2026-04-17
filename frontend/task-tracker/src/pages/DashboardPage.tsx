import { useState, useMemo } from "react";
import { hasRecurringInstance, getProjectedDate } from "@/utils/task";
import { computeStatus } from "@/utils/task";
import { avatarColor } from "@/utils/avatar";
import { MONTHS } from "@/utils/date";
import { exportCSV } from "@/utils/csv";
import TaskDetailTable from "@/components/dashboard/TaskDetailTable";
import StatusDist from "@/components/dashboard/StatusDist";
import ClientDist from "@/components/dashboard/ClientDist";
import TeamTable from "@/components/dashboard/TeamTable";
import ReportView from "@/components/dashboard/ReportView";
import RecentCompletions from "@/components/dashboard/RecentCompletions";
import type { Task, Profile, DashboardDrillDown } from "@/types";

interface DashboardPageProps {
  tasks: Task[];
  profile: Profile | null;
  profiles?: Profile[];
  onAddTask?: (() => void) | null;
  onPatchTask?: (
    taskId: string,
    patch: {
      targetDate?: string | null;
      expectedDate?: string | null;
      completedDate?: string | null;
      remarks?: string;
    },
  ) => Promise<void>;
}

export default function DashboardPage({
  tasks,
  profile,
  profiles = [],
  onAddTask = null,
  onPatchTask,
}: DashboardPageProps) {
  const [period, setPeriod] = useState("");
  const [fClient, setFClient] = useState("");
  const [fMember, setFMember] = useState("");
  const [drillDown, setDrillDown] = useState<DashboardDrillDown | null>(null);

  const now = new Date();
  const monthOptions = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthOptions.push({
      v,
      label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
    });
  }

  const myName = profile?.full_name || "";
  const isAdmin = profile?.role === "admin";
  const isManager = profile?.role === "manager";

  const allClients = useMemo(
    () => [...new Set(tasks.map((t) => t.client).filter(Boolean))] as string[],
    [tasks],
  );
  const allMembers = useMemo(
    () =>
      [...new Set(tasks.map((t) => t.responsible).filter(Boolean))] as string[],
    [tasks],
  );

  const filteredTasks = useMemo(() => {
    let src = tasks;

    if (period) {
      const [selY, selM] = period.split("-").map(Number);
      const selMonth = selM - 1;
      src = src
        .map((t) => {
          const r = t.recurrence || "Onetime";
          if (r === "Onetime") {
            return (t.targetDate || "").startsWith(period) ? t : null;
          }
          if (!hasRecurringInstance(t, selY, selMonth)) return null;
          const projectedDate = getProjectedDate(t, selY, selMonth);
          const origMonth = (t.targetDate || "").slice(0, 7);
          const isDiffCycle = origMonth !== period;
          const projectedTask = {
            ...t,
            targetDate: projectedDate,
            ...(isDiffCycle
              ? { expectedDate: "", completedDate: "", remarks: "" }
              : {}),
          };
          return { ...projectedTask, status: computeStatus(projectedTask) };
        })
        .filter((t): t is Task => t !== null);
    }

    if (!isAdmin) {
      if (isManager && profile) {
        const managedNames = profiles
          .filter((p) => (p.manager_ids ?? []).includes(profile.id))
          .map((p) => p.full_name || "");
        src = src.filter(
          (t) =>
            t.responsible === myName || managedNames.includes(t.responsible),
        );
      } else {
        src = src.filter((t) => t.responsible === myName);
      }
    }

    if (fClient) src = src.filter((t) => t.client === fClient);
    if (fMember) src = src.filter((t) => t.responsible === fMember);

    return src;
  }, [
    tasks,
    period,
    fClient,
    fMember,
    isAdmin,
    isManager,
    myName,
    profiles,
    profile,
  ]);

  const teamNames = [
    ...new Set(filteredTasks.map((t) => t.responsible).filter(Boolean)),
  ] as string[];
  const done = filteredTasks.filter((t) =>
    ["Ontime", "Completed Delay"].includes(t.status),
  ).length;
  const overdue = filteredTasks.filter((t) => t.status === "Overdue").length;
  const pct = filteredTasks.length
    ? Math.round((done / filteredTasks.length) * 100)
    : 0;

  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const todayTasks = filteredTasks.filter((t) => t.targetDate === todayStr);
  const activeTasks = filteredTasks.filter(
    (t) =>
      !["Ontime", "Completed Delay"].includes(t.status) &&
      t.targetDate !== todayStr,
  );

  const cardStyle = (color: string) => ({
    background: "#fff",
    borderRadius: 10,
    padding: "16px 20px",
    borderTop: `4px solid ${color}`,
    boxShadow: "0 1px 4px rgba(0,0,0,.08)",
    minWidth: 120,
  });
  const boxStyle = {
    background: "#fff",
    borderRadius: 10,
    padding: 16,
    boxShadow: "0 1px 4px rgba(0,0,0,.08)",
    marginBottom: 12,
  };

  // ── Drill-down views ───────────────────────────────────────────────────────
  if (drillDown?.type === "report") {
    return (
      <div style={{ padding: "16px 20px" }}>
        <ReportView
          tasks={filteredTasks}
          onBack={() => setDrillDown(null)}
          profile={profile}
          onAddTask={onAddTask}
        />
      </div>
    );
  }
  if (drillDown?.type === "status") {
    const slice = filteredTasks.filter((t) => t.status === drillDown.value);
    return (
      <div style={{ padding: "16px 20px" }}>
        <TaskDetailTable
          tasks={slice}
          title={
            <span>
              Tasks with status:{" "}
              <span style={{ fontWeight: 700 }}>{drillDown.value}</span>
            </span>
          }
          onBack={() => setDrillDown(null)}
          filename={`status-${drillDown.value}.csv`}
          editable={true}
          profile={profile}
          onAddTask={onAddTask}
          onPatchTask={onPatchTask}
        />
      </div>
    );
  }
  if (drillDown?.type === "client") {
    const slice = filteredTasks.filter((t) => t.client === drillDown.value);
    return (
      <div style={{ padding: "16px 20px" }}>
        <TaskDetailTable
          tasks={slice}
          title={
            <span>
              Tasks for client:{" "}
              <span style={{ color: "#2563eb", fontWeight: 700 }}>
                {drillDown.value}
              </span>
            </span>
          }
          onBack={() => setDrillDown(null)}
          filename={`client-${drillDown.value}.csv`}
          editable={true}
          profile={profile}
          onAddTask={onAddTask}
          onPatchTask={onPatchTask}
        />
      </div>
    );
  }
  if (drillDown?.type === "member") {
    const name = drillDown.value ?? "";
    const mine = filteredTasks.filter((t) => t.responsible === name);
    const color = avatarColor(name);
    const mdone = mine.filter((t) =>
      ["Ontime", "Completed Delay"].includes(t.status),
    ).length;
    const mpct = mine.length ? Math.round((mdone / mine.length) * 100) : 0;
    return (
      <div style={{ padding: "16px 20px" }}>
        <div
          className="dm-box"
          style={{
            ...boxStyle,
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              background: color,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              fontWeight: 700,
            }}
          >
            {name.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{name}</div>
            <div style={{ color: "#64748b", fontSize: 13 }}>
              {mine.length} task(s) · {mpct}% completion
            </div>
          </div>
          <button
            onClick={() => setDrillDown(null)}
            style={{
              marginLeft: "auto",
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid #e2e8f0",
              background: "#f8fafc",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            ← Back to Dashboard
          </button>
        </div>
        <TaskDetailTable
          tasks={mine}
          title={`All tasks — ${name}`}
          filename={`member-${name}.csv`}
          editable={true}
          profile={profile}
          onAddTask={onAddTask}
          onPatchTask={onPatchTask}
        />
      </div>
    );
  }
  if (drillDown?.type === "today") {
    return (
      <div style={{ padding: "16px 20px" }}>
        <TaskDetailTable
          tasks={todayTasks}
          title={
            <span>
              📅 Today's Tasks —{" "}
              <span style={{ color: "#0891b2", fontWeight: 700 }}>
                {new Date().toLocaleDateString("en-IN", {
                  weekday: "long",
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </span>
          }
          onBack={() => setDrillDown(null)}
          filename={`today-tasks-${todayStr}.csv`}
          editable={true}
          profile={profile}
          onAddTask={onAddTask}
          onPatchTask={onPatchTask}
        />
      </div>
    );
  }
  if (drillDown?.type === "active") {
    return (
      <div style={{ padding: "16px 20px" }}>
        <TaskDetailTable
          tasks={activeTasks}
          title={
            <span>
              ⚡ Active Tasks{" "}
              <span style={{ color: "#d97706", fontWeight: 700 }}>
                (excluding today)
              </span>
            </span>
          }
          onBack={() => setDrillDown(null)}
          filename="active-tasks.csv"
          editable={true}
          profile={profile}
          onAddTask={onAddTask}
          onPatchTask={onPatchTask}
        />
      </div>
    );
  }

  // ── Main dashboard ─────────────────────────────────────────────────────────
  return (
    <div style={{ padding: "16px 20px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div className="page-title">
          📊{" "}
          {isAdmin
            ? "Team Dashboard"
            : isManager
              ? `My Team Dashboard — ${myName}`
              : `My Dashboard — ${myName}`}
        </div>
        <button
          onClick={() => setDrillDown({ type: "report" })}
          style={{
            padding: "7px 16px",
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          📋 Full Report
        </button>
      </div>

      {/* Filter bar */}
      <div
        className="dm-filter-bar"
        style={{
          ...boxStyle,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 14px",
          overflowX: "auto",
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#64748b",
            whiteSpace: "nowrap",
          }}
        >
          📅
        </span>
        <select
          value={period}
          onChange={(e) => {
            setPeriod(e.target.value);
            setDrillDown(null);
          }}
          style={{
            padding: "5px 8px",
            border: "1px solid #e2e8f0",
            borderRadius: 6,
            fontSize: 12,
            minWidth: 110,
            maxWidth: 140,
          }}
        >
          <option value="">All Months</option>
          {monthOptions.map((m) => (
            <option key={m.v} value={m.v}>
              {m.label}
            </option>
          ))}
        </select>
        <span style={{ color: "#cbd5e1", fontSize: 18, flexShrink: 0 }}>|</span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#64748b",
            whiteSpace: "nowrap",
          }}
        >
          🏢
        </span>
        <select
          value={fClient}
          onChange={(e) => {
            setFClient(e.target.value);
            setDrillDown(null);
          }}
          style={{
            padding: "5px 8px",
            border: "1px solid #e2e8f0",
            borderRadius: 6,
            fontSize: 12,
            minWidth: 110,
            maxWidth: 150,
          }}
        >
          <option value="">All Clients</option>
          {allClients.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <span style={{ color: "#cbd5e1", fontSize: 18, flexShrink: 0 }}>|</span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#64748b",
            whiteSpace: "nowrap",
          }}
        >
          👤
        </span>
        <select
          value={fMember}
          onChange={(e) => {
            setFMember(e.target.value);
            setDrillDown(null);
          }}
          style={{
            padding: "5px 8px",
            border: "1px solid #e2e8f0",
            borderRadius: 6,
            fontSize: 12,
            minWidth: 110,
            maxWidth: 150,
          }}
        >
          <option value="">All Members</option>
          {allMembers.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        {(period || fClient || fMember) && (
          <button
            onClick={() => {
              setPeriod("");
              setFClient("");
              setFMember("");
              setDrillDown(null);
            }}
            style={{
              padding: "4px 10px",
              fontSize: 11,
              borderRadius: 6,
              border: "1px solid #fecaca",
              background: "#fff1f2",
              color: "#dc2626",
              cursor: "pointer",
              fontWeight: 600,
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            ✕ Clear
          </button>
        )}
        <button
          onClick={() =>
            exportCSV(
              filteredTasks.map((t) => ({
                "#": t.serialNo || "",
                Description: t.description || "",
                Client: t.client || "",
                Category: t.category || "",
                Responsible: t.responsible || "",
                Recurrence: t.recurrence || "Onetime",
                Status: t.status || "",
                "Target Date": t.targetDate || "",
                "Expected Date": t.expectedDate || "",
                "Comp Date": t.completedDate || "",
                Remarks: t.remarks || "",
              })),
              "all-tasks.csv",
            )
          }
          style={{
            marginLeft: "auto",
            padding: "5px 12px",
            background: "#16a34a",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            fontWeight: 600,
            fontSize: 11,
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          ⬇ Export CSV
        </button>
      </div>

      {/* Stat cards */}
      <div
        style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}
      >
        <div className="dm-stat-card" style={cardStyle("#2563eb")}>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#2563eb" }}>
            {filteredTasks.length}
          </div>
          <div
            className="dm-stat-lbl"
            style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}
          >
            {isAdmin ? "Total Tasks" : isManager ? "Team Tasks" : "My Tasks"}
          </div>
        </div>
        <div className="dm-stat-card" style={cardStyle("#15803d")}>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#15803d" }}>
            {done}
          </div>
          <div
            className="dm-stat-lbl"
            style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}
          >
            Completed
          </div>
        </div>
        <div
          className="dm-stat-card"
          onClick={() => setDrillDown({ type: "active" })}
          style={{ ...cardStyle("#d97706"), cursor: "pointer" }}
          title="Click to view active tasks"
        >
          <div style={{ fontSize: 26, fontWeight: 800, color: "#d97706" }}>
            {activeTasks.length}
          </div>
          <div
            className="dm-stat-lbl"
            style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}
          >
            Active
          </div>
        </div>
        <div
          className="dm-stat-card"
          onClick={() => setDrillDown({ type: "today" })}
          style={{ ...cardStyle("#0891b2"), cursor: "pointer" }}
          title="Click to view today's tasks"
        >
          <div style={{ fontSize: 26, fontWeight: 800, color: "#0891b2" }}>
            {todayTasks.length}
          </div>
          <div
            className="dm-stat-lbl"
            style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}
          >
            Today
          </div>
        </div>
        <div className="dm-stat-card" style={cardStyle("#dc2626")}>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#dc2626" }}>
            {overdue}
          </div>
          <div
            className="dm-stat-lbl"
            style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}
          >
            Overdue
          </div>
        </div>
        <div className="dm-stat-card" style={cardStyle("#7c3aed")}>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#7c3aed" }}>
            {pct}%
          </div>
          <div
            className="dm-stat-lbl"
            style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}
          >
            Completion Rate
          </div>
        </div>
      </div>

      {isAdmin || isManager ? (
        <>
          <div className="dm-box" style={boxStyle}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
              👥 {isAdmin ? "Team" : "My Team"} Performance
              <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 400 }}>
                {" "}
                (click member name to view tasks)
              </span>
            </div>
            <TeamTable
              tasks={filteredTasks}
              teamNames={teamNames}
              todayStr={todayStr}
              onSelectMember={(name) =>
                setDrillDown({ type: "member", value: name })
              }
              onTaskUpdated={() => {}}
              onPatchTask={onPatchTask}
              profile={profile}
            />
          </div>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
          >
            <div className="dm-box" style={boxStyle}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
                📈 Status Distribution{" "}
                <span
                  style={{ fontSize: 11, color: "#94a3b8", fontWeight: 400 }}
                >
                  (click to view tasks)
                </span>
              </div>
              <StatusDist
                tasks={filteredTasks}
                onSelectStatus={(s) =>
                  setDrillDown({ type: "status", value: s })
                }
              />
            </div>
            <div className="dm-box" style={boxStyle}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
                🏢 By Client{" "}
                <span
                  style={{ fontSize: 11, color: "#94a3b8", fontWeight: 400 }}
                >
                  (click to view tasks)
                </span>
              </div>
              <ClientDist
                tasks={filteredTasks}
                onSelectClient={(c) =>
                  setDrillDown({ type: "client", value: c })
                }
              />
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="dm-box" style={boxStyle}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
              📋 Active Tasks{" "}
              <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 400 }}>
                (excluding today's tasks)
              </span>
            </div>
            <TaskDetailTable
              tasks={activeTasks}
              title=""
              filename="my-active-tasks.csv"
            />
          </div>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
          >
            <div className="dm-box" style={boxStyle}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
                📈 Status Distribution
              </div>
              <StatusDist
                tasks={filteredTasks}
                onSelectStatus={(s) =>
                  setDrillDown({ type: "status", value: s })
                }
              />
            </div>
            <div className="dm-box" style={boxStyle}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
                ✅ Recent Completions
              </div>
              <RecentCompletions tasks={filteredTasks} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
