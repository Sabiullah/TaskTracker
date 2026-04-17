import { avatarColor } from "@/utils/avatar";
import type { Task } from "@/types";
import type { Profile } from "@/types";

interface AdminDashboardProps {
  tasks: Task[];
  profiles: Profile[];
  onFilterEmployee: (name: string) => void;
  activeEmployee: string;
  onClose: () => void;
}

export default function AdminDashboard({
  tasks,
  profiles,
  onFilterEmployee,
  activeEmployee,
  onClose,
}: AdminDashboardProps) {
  // Build employee name list: prefer profiles table, fall back to task responsible field
  const profileNames = profiles?.map((p) => p.full_name).filter(Boolean) ?? [];
  const taskNames = [
    ...new Set(tasks.map((t) => t.responsible).filter(Boolean)),
  ];
  const names =
    profileNames.length > 0
      ? [...new Set([...profileNames, ...taskNames])]
      : taskNames;

  const stats = names.map((name) => {
    const mine = tasks.filter((t) => t.responsible === name);
    const done = mine.filter((t) =>
      ["Completed", "Ontime", "Completed Delay"].includes(t.status),
    ).length;
    return {
      name,
      total: mine.length,
      today: mine.filter((t) => t.status === "TodayTask").length,
      tomorrow: mine.filter((t) => t.status === "Tomorrow").length,
      pending: mine.filter((t) => t.status === "Pending").length,
      overdue: mine.filter((t) => t.status === "Overdue").length,
      completed: done,
      pct: mine.length ? Math.round((done / mine.length) * 100) : 0,
    };
  });

  const totalOverdue = tasks.filter((t) => t.status === "Overdue").length;
  const totalCompleted = tasks.filter((t) =>
    ["Completed", "Ontime", "Completed Delay"].includes(t.status),
  ).length;
  const totalToday = tasks.filter((t) => t.status === "TodayTask").length;

  return (
    <div className="admin-overlay" onClick={onClose}>
      <div className="admin-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="admin-panel-head">
          <span className="admin-panel-title">Admin Dashboard</span>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Top summary cards */}
        <div className="admin-summary">
          <div className="admin-stat-card">
            <div className="admin-stat-val">{tasks.length}</div>
            <div className="admin-stat-lbl">Total Tasks</div>
          </div>
          <div className="admin-stat-card">
            <div className="admin-stat-val" style={{ color: "#f59e0b" }}>
              {totalToday}
            </div>
            <div className="admin-stat-lbl">Due Today</div>
          </div>
          <div className="admin-stat-card">
            <div className="admin-stat-val" style={{ color: "#ef4444" }}>
              {totalOverdue}
            </div>
            <div className="admin-stat-lbl">Overdue</div>
          </div>
          <div className="admin-stat-card">
            <div className="admin-stat-val" style={{ color: "#22c55e" }}>
              {totalCompleted}
            </div>
            <div className="admin-stat-lbl">Completed</div>
          </div>
          <div className="admin-stat-card">
            <div className="admin-stat-val">{names.length}</div>
            <div className="admin-stat-lbl">Employees</div>
          </div>
        </div>

        {/* Per-employee table */}
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Total</th>
                <th>Today</th>
                <th>Tomorrow</th>
                <th>Pending</th>
                <th>Overdue</th>
                <th>Done</th>
                <th>Progress</th>
                <th>Filter Board</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => (
                <tr
                  key={s.name}
                  className={activeEmployee === s.name ? "active-row" : ""}
                >
                  <td>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <div
                        className="avatar"
                        style={{
                          background: avatarColor(s.name),
                          width: 28,
                          height: 28,
                          fontSize: 11,
                        }}
                      >
                        {s.name.slice(0, 2).toUpperCase()}
                      </div>
                      <span style={{ fontWeight: 600 }}>{s.name}</span>
                    </div>
                  </td>
                  <td style={{ fontWeight: 600 }}>{s.total}</td>
                  <td>
                    <span style={{ color: "#f59e0b", fontWeight: 600 }}>
                      {s.today}
                    </span>
                  </td>
                  <td>
                    <span style={{ color: "#0891b2", fontWeight: 600 }}>
                      {s.tomorrow}
                    </span>
                  </td>
                  <td>
                    <span style={{ color: "#d97706", fontWeight: 600 }}>
                      {s.pending}
                    </span>
                  </td>
                  <td>
                    <span
                      style={{
                        color: s.overdue > 0 ? "#ef4444" : "#9ca3af",
                        fontWeight: s.overdue > 0 ? 700 : 400,
                      }}
                    >
                      {s.overdue > 0 ? `⚠ ${s.overdue}` : s.overdue}
                    </span>
                  </td>
                  <td>
                    <span style={{ color: "#22c55e", fontWeight: 600 }}>
                      {s.completed}
                    </span>
                  </td>
                  <td style={{ minWidth: 120 }}>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <div
                        style={{
                          flex: 1,
                          height: 7,
                          background: "#e5e7eb",
                          borderRadius: 4,
                        }}
                      >
                        <div
                          style={{
                            width: `${s.pct}%`,
                            height: "100%",
                            borderRadius: 4,
                            background:
                              s.pct >= 80
                                ? "#22c55e"
                                : s.pct >= 50
                                  ? "#f59e0b"
                                  : "#ef4444",
                            transition: "width .3s",
                          }}
                        />
                      </div>
                      <span
                        style={{
                          fontSize: 11,
                          color: "#6b7280",
                          minWidth: 34,
                          textAlign: "right",
                        }}
                      >
                        {s.pct}%
                      </span>
                    </div>
                  </td>
                  <td>
                    <button
                      className={`btn-header${activeEmployee === s.name ? "" : " primary"}`}
                      style={{
                        padding: "3px 12px",
                        fontSize: 11,
                        borderRadius: 4,
                      }}
                      onClick={() =>
                        onFilterEmployee(
                          activeEmployee === s.name ? "" : s.name,
                        )
                      }
                    >
                      {activeEmployee === s.name ? "✕ Clear" : "View"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {activeEmployee && (
          <div className="admin-filter-note">
            Board is filtered to: <strong>{activeEmployee}</strong> —{" "}
            <button className="login-link" onClick={() => onFilterEmployee("")}>
              show all employees
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
