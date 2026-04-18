import { avatarColor } from "@/utils/avatar";
import MultiManagerSelect from "./MultiManagerSelect";
import type { Profile } from "@/types";

const ROLES = ["admin", "manager", "employee"];
const ROLE_COLORS: Record<string, string> = {
  admin: "#dbeafe",
  manager: "#fef3c7",
  employee: "#f1f5f9",
};
const ROLE_TEXT: Record<string, string> = {
  admin: "#1d4ed8",
  manager: "#92400e",
  employee: "#475569",
};

export interface UserTableProps {
  profiles: Profile[];
  updating: string | null;
  onRoleChange: (userId: string, newRole: string) => void;
  onManagerChange: (userId: string, managerIds: string[]) => void;
  onToggleInvoice: (userId: string) => void;
  onToggleNotice: (userId: string) => void;
  onToggleMasters: (userId: string) => void;
  onToggleAttendance: (userId: string) => void;
  onToggleEmployee: (userId: string) => void;
  onOpenReset: (p: Profile) => void;
  onOpenDelete: (p: Profile) => void;
}

export default function UserTable({
  profiles,
  updating,
  onRoleChange,
  onManagerChange,
  onToggleInvoice,
  onToggleNotice,
  onToggleMasters,
  onToggleAttendance,
  onToggleEmployee,
  onOpenReset,
  onOpenDelete,
}: UserTableProps) {
  const managers = profiles.filter(
    (p) => p.highest_role === "admin" || p.highest_role === "manager",
  );

  return (
    <div className="sticky-table-wrap">
      <table
        style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
      >
        <thead>
          <tr style={{ background: "#f8fafc" }}>
            {[
              "User",
              "Username",
              "Role",
              "Reports To",
              "Change Role",
              "Assign Manager",
              "Password",
              "Invoice Access",
              "Notice Access",
              "Client Master",
              "Attendance",
              "Employee",
              "Delete",
            ].map((h) => (
              <th
                key={h}
                style={{
                  padding: "8px 12px",
                  textAlign: "left",
                  fontWeight: 700,
                  color: h === "Delete" ? "#dc2626" : "#475569",
                  fontSize: 12,
                  borderBottom: "2px solid #e2e8f0",
                  whiteSpace: "nowrap",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {profiles.map((p) => {
            const name = p.full_name || p.email || "?";
            const color = avatarColor(name);
            const mgrIds = p.manager_ids?.length ? p.manager_ids : [];
            const mgrNames = mgrIds
              .map((id) => {
                const m = profiles.find((x) => x.id === id);
                return m ? m.full_name || m.email : null;
              })
              .filter(Boolean);
            const mgrDisplay = mgrNames.length ? mgrNames.join(", ") : "—";

            return (
              <tr key={p.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "10px 12px" }}>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: "50%",
                        background: color,
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 12,
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {name.slice(0, 2).toUpperCase()}
                    </div>
                    <span style={{ fontWeight: 600 }}>{name}</span>
                  </div>
                </td>
                <td
                  style={{
                    padding: "10px 12px",
                    color: "#64748b",
                    fontSize: 12,
                  }}
                >
                  {p.email?.replace("@tasktracker.local", "") || p.email}
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <span
                    style={{
                      padding: "2px 10px",
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 700,
                      background: ROLE_COLORS[p.highest_role || "employee"],
                      color: ROLE_TEXT[p.highest_role || "employee"],
                    }}
                  >
                    {p.highest_role === "admin"
                      ? "👑"
                      : p.highest_role === "manager"
                        ? "👔"
                        : "👤"}{" "}
                    {p.highest_role || "employee"}
                  </span>
                </td>
                <td
                  style={{
                    padding: "10px 12px",
                    color: "#64748b",
                    fontSize: 12,
                    maxWidth: 180,
                  }}
                >
                  {mgrDisplay}
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <select
                    value={p.highest_role || "employee"}
                    disabled={updating === p.id}
                    onChange={(e) => onRoleChange(p.id, e.target.value)}
                    style={{
                      padding: "5px 8px",
                      border: "1px solid #e2e8f0",
                      borderRadius: 5,
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  {updating === p.id && (
                    <span
                      style={{ fontSize: 11, color: "#64748b", marginLeft: 6 }}
                    >
                      Saving…
                    </span>
                  )}
                </td>
                <td style={{ padding: "10px 12px" }}>
                  {(p.highest_role === "employee" || p.highest_role === "manager") && (
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 6 }}
                    >
                      <MultiManagerSelect
                        options={managers.filter((m) => m.id !== p.id)}
                        selected={mgrIds}
                        disabled={updating === p.id + "-mgr"}
                        onChange={(ids) => onManagerChange(p.id, ids)}
                      />
                      {updating === p.id + "-mgr" && (
                        <span style={{ fontSize: 11, color: "#64748b" }}>
                          Saving…
                        </span>
                      )}
                    </div>
                  )}
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <button
                    onClick={() => onOpenReset(p)}
                    style={{
                      padding: "4px 10px",
                      border: "1px solid #e2e8f0",
                      background: "#f8fafc",
                      borderRadius: 5,
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#475569",
                      whiteSpace: "nowrap",
                    }}
                  >
                    🔑 Reset Pwd
                  </button>
                </td>
                {/* Access toggles */}
                {(
                  [
                    {
                      enabled: p.orgs.some(o => o.invoice_access),
                      onToggle: onToggleInvoice,
                      color: "#16a34a",
                    },
                    {
                      enabled: p.orgs.some(o => o.notice_access),
                      onToggle: onToggleNotice,
                      color: "#7c3aed",
                    },
                    {
                      enabled: p.orgs.some(o => o.masters_access),
                      onToggle: onToggleMasters,
                      color: "#0891b2",
                    },
                    {
                      enabled: p.orgs.some(o => o.attendance_access),
                      onToggle: onToggleAttendance,
                      color: "#d97706",
                    },
                    {
                      enabled: p.orgs.some(o => o.employee_access),
                      onToggle: onToggleEmployee,
                      color: "#2563eb",
                    },
                  ] as const
                ).map(({ enabled, onToggle, color: btnColor }, i) => (
                  <td
                    key={i}
                    style={{ padding: "10px 12px", textAlign: "center" }}
                  >
                    {p.highest_role !== "admin" ? (
                      <button
                        onClick={() => onToggle(p.id)}
                        style={{
                          padding: "4px 12px",
                          borderRadius: 20,
                          border: "none",
                          cursor: "pointer",
                          fontSize: 12,
                          fontWeight: 700,
                          background: enabled ? btnColor : "#e2e8f0",
                          color: enabled ? "#fff" : "#64748b",
                        }}
                      >
                        {enabled ? "✅ Enabled" : "○ Disabled"}
                      </button>
                    ) : (
                      <span style={{ fontSize: 11, color: "#94a3b8" }}>
                        Always On
                      </span>
                    )}
                  </td>
                ))}
                <td style={{ padding: "10px 12px", textAlign: "center" }}>
                  {p.highest_role !== "admin" ? (
                    <button
                      onClick={() => onOpenDelete(p)}
                      title={`Delete ${p.full_name || p.email}`}
                      style={{
                        padding: "4px 10px",
                        borderRadius: 6,
                        border: "1px solid #fecaca",
                        background: "#fff1f2",
                        color: "#dc2626",
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 700,
                        whiteSpace: "nowrap",
                      }}
                    >
                      🗑 Delete
                    </button>
                  ) : (
                    <span style={{ fontSize: 11, color: "#94a3b8" }}>—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {profiles.length === 0 && (
        <p
          style={{
            color: "#94a3b8",
            fontSize: 13,
            textAlign: "center",
            padding: "20px 0",
          }}
        >
          No users yet.
        </p>
      )}
    </div>
  );
}
