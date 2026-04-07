import { useState, useRef, useEffect } from "react";
import { apiGet, apiPost, apiPatch } from "@/lib/api";
import { AVATAR_COLORS, TEAM_MEMBERS } from "@/constants";
import type {
  RoleKey,
  UserProfile,
  MultiManagerSelectProps,
  UsersPageProps,
  CreateUserForm,
  ResetTarget,
} from "@/types/users";

// Load team members from localStorage (same source as Masters page)
// Falls back to the static TEAM_MEMBERS list if localStorage is empty
function loadTeamMembers() {
  try {
    const stored = localStorage.getItem("tt_team");
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0)
        return parsed.map((m) => m.name || m);
    }
  } catch {
    /* ignore parse errors */
  }
  return TEAM_MEMBERS;
}

const ROLES = ["admin", "manager", "employee"];
const ROLE_COLORS: Record<RoleKey, string> = {
  admin: "#dbeafe",
  manager: "#fef3c7",
  employee: "#f1f5f9",
};
const ROLE_TEXT: Record<RoleKey, string> = {
  admin: "#1d4ed8",
  manager: "#92400e",
  employee: "#475569",
};

async function adminCreateUser(
  name: string,
  username: string,
  email: string,
  password: string,
  role: string,
  managerId: string | null,
) {
  try {
    const data = await apiPost("/users/create/", {
      name,
      username,
      email,
      password: password || "123456",
      role,
      manager_id: managerId || null,
    });
    return { data };
  } catch (err) {
    return { error: { message: (err as Error).message } };
  }
}

// ── Multi-manager checkbox dropdown ──────────────────────────────────────────
function MultiManagerSelect({
  options,
  selected,
  onChange,
  disabled,
}: MultiManagerSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggle = (id: string) => {
    const next = selected.includes(id)
      ? selected.filter((x: string) => x !== id)
      : [...selected, id];
    onChange(next);
  };

  const label =
    selected.length === 0
      ? "— None —"
      : options
          .filter((o: UserProfile) => selected.includes(o.id))
          .map((o: UserProfile) => o.full_name || o.email)
          .join(", ");

  return (
    <div ref={ref} style={{ position: "relative", minWidth: 160 }}>
      <div
        onClick={() => !disabled && setOpen((o) => !o)}
        style={{
          padding: "5px 28px 5px 8px",
          border: "1px solid #e2e8f0",
          borderRadius: 5,
          fontSize: 12,
          cursor: disabled ? "not-allowed" : "pointer",
          background: "#fff",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          maxWidth: 220,
          position: "relative",
          userSelect: "none",
          color: selected.length ? "#1e293b" : "#94a3b8",
          opacity: disabled ? 0.6 : 1,
        }}
        title={label}
      >
        {label}
        <span
          style={{
            position: "absolute",
            right: 6,
            top: "50%",
            transform: "translateY(-50%)",
            color: "#94a3b8",
            fontSize: 10,
          }}
        >
          ▼
        </span>
      </div>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "110%",
            left: 0,
            zIndex: 200,
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,.14)",
            minWidth: 200,
            maxHeight: 240,
            overflowY: "auto",
          }}
        >
          {/* Clear all */}
          <div
            onClick={() => onChange([])}
            style={{
              padding: "7px 12px",
              fontSize: 12,
              color: "#dc2626",
              cursor: "pointer",
              borderBottom: "1px solid #f1f5f9",
              fontWeight: 600,
            }}
          >
            ✕ Clear all
          </div>
          {options.map((o: UserProfile) => {
            const checked = selected.includes(o.id);
            return (
              <label
                key={o.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "7px 12px",
                  cursor: "pointer",
                  fontSize: 12,
                  background: checked ? "#eff6ff" : "transparent",
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(o.id)}
                  style={{
                    accentColor: "#2563eb",
                    width: 14,
                    height: 14,
                    cursor: "pointer",
                  }}
                />
                <span
                  style={{
                    fontWeight: checked ? 600 : 400,
                    color: checked ? "#2563eb" : "#1e293b",
                  }}
                >
                  {o.full_name || o.email}
                </span>
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 10,
                    color: "#94a3b8",
                    textTransform: "uppercase",
                  }}
                >
                  {o.role}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function UsersPage({ profiles, onRefresh }: UsersPageProps) {
  const [updating, setUpdating] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState("");
  const [bulkStatus, setBulkStatus] = useState("");
  const [invoiceAccess, setInvoiceAccess] = useState<string[]>([]); // user_ids with invoice access
  const [noticeAccess, setNoticeAccess] = useState<string[]>([]); // user_ids with notice access
  const [form, setForm] = useState<CreateUserForm>({
    username: "",
    email: "",
    password: "123456",
    role: "employee",
    manager_id: "",
  });

  // Load invoice & notice access from profiles
  useEffect(() => {
    apiGet<UserProfile[]>("/profiles/").then((data) => {
      setInvoiceAccess(data.filter((p) => p.invoice_access).map((p) => p.id));
      setNoticeAccess(data.filter((p) => p.notice_access).map((p) => p.id));
    });
  }, []);

  const toggleInvoiceAccess = async (userId: string) => {
    const hasAccess = invoiceAccess.includes(userId);
    await apiPatch(`/users/${userId}/`, { invoice_access: !hasAccess });
    setInvoiceAccess((prev) =>
      hasAccess ? prev.filter((id) => id !== userId) : [...prev, userId],
    );
  };

  const toggleNoticeAccess = async (userId: string) => {
    const hasAccess = noticeAccess.includes(userId);
    await apiPatch(`/users/${userId}/`, { notice_access: !hasAccess });
    setNoticeAccess((prev) =>
      hasAccess ? prev.filter((id) => id !== userId) : [...prev, userId],
    );
  };

  // Password reset state
  const [resetTarget, setResetTarget] = useState<ResetTarget | null>(null); // { id, full_name }
  const [resetPwd, setResetPwd] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetErr, setResetErr] = useState("");
  const [resetSuccess, setResetSuccess] = useState("");

  // Delete user state
  const [deleteTarget, setDeleteTarget] = useState<ResetTarget | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState("");

  const handleDeleteUser = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteErr("");
    try {
      await apiPost("/users/delete/", { user_id: deleteTarget.id });
      setDeleteTarget(null);
      setDeleteConfirm("");
      if (onRefresh) onRefresh();
    } catch (err) {
      setDeleteErr((err as Error).message);
    }
    setDeleteBusy(false);
  };

  const set = (k: keyof CreateUserForm, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const allMembers = loadTeamMembers(); // reads from localStorage (includes Masters additions)
  const managers = profiles.filter(
    (p: UserProfile) => p.role === "admin" || p.role === "manager",
  );
  const existingNames = profiles.map((p: UserProfile) =>
    (p.full_name || "").toLowerCase(),
  );
  const missingMembers = allMembers.filter(
    (m: string) => !existingNames.includes(m.toLowerCase()),
  );

  /* ── Single user create ── */
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.username && !form.email) {
      setCreateErr("Please provide a username or email.");
      return;
    }
    setCreating(true);
    setCreateErr("");
    const { error } = await adminCreateUser(
      form.username,
      form.username,
      form.email,
      form.password || "123456",
      form.role,
      form.manager_id,
    );
    setCreating(false);
    if (error) {
      setCreateErr(error.message);
      return;
    }
    setShowCreate(false);
    setForm({
      username: "",
      email: "",
      password: "123456",
      role: "employee",
      manager_id: "",
    });
    if (onRefresh) onRefresh();
  };

  /* ── Bulk create all missing team members ── */
  const handleBulkCreate = async () => {
    if (missingMembers.length === 0) {
      alert("All team members already have accounts!");
      return;
    }
    if (
      !window.confirm(
        `Create accounts for ${missingMembers.length} team members?\n\n${missingMembers.join(", ")}\n\nDefault password: 123456`,
      )
    )
      return;

    setBulkStatus("Creating…");
    let done = 0;
    const failed: string[] = [];
    for (const name of missingMembers) {
      const { error } = await adminCreateUser(
        name,
        name.toLowerCase(),
        "",
        "123456",
        "employee",
        null,
      );
      if (error) failed.push(`${name}: ${error.message}`);
      else done++;
      setBulkStatus(`Creating… ${done}/${missingMembers.length}`);
    }
    setBulkStatus("");
    if (failed.length)
      alert(`Created ${done} users.\n\nFailed:\n${failed.join("\n")}`);
    else
      alert(
        `✅ Successfully created ${done} user accounts!\n\nAll with password: 123456\nYou can now assign roles and managers.`,
      );
    if (onRefresh) onRefresh();
  };

  /* ── Password reset ── */
  const openReset = (p: ResetTarget) => {
    setResetTarget(p);
    setResetPwd("123456");
    setResetErr("");
    setResetSuccess("");
  };
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (resetPwd.length < 6) {
      setResetErr("Password must be at least 6 characters.");
      return;
    }
    setResetBusy(true);
    setResetErr("");
    setResetSuccess("");
    try {
      await apiPost("/users/reset-password/", {
        user_id: resetTarget!.id,
        new_password: resetPwd,
      });
      setResetSuccess(
        `✅ Password updated for ${resetTarget!.full_name || resetTarget!.email}`,
      );
    } catch (err) {
      setResetErr((err as Error).message);
    }
    setResetBusy(false);
  };

  /* ── Role / manager update ── */
  const handleRoleChange = async (userId: string, newRole: string) => {
    setUpdating(userId);
    try {
      await apiPatch(`/users/${userId}/`, { role: newRole });
      if (onRefresh) onRefresh();
    } catch (err) {
      alert("Failed to update role: " + (err as Error).message);
    }
    setUpdating(null);
  };

  const handleManagerChange = async (userId: string, managerIds: string[]) => {
    setUpdating(userId + "-mgr");
    try {
      await apiPatch(`/users/${userId}/`, { manager_ids: managerIds });
      if (onRefresh) onRefresh();
    } catch (err) {
      alert("Failed to update managers: " + (err as Error).message);
    }
    setUpdating(null);
  };

  const boxStyle = {
    background: "#fff",
    borderRadius: 10,
    padding: 16,
    boxShadow: "0 1px 4px rgba(0,0,0,.08)",
    marginBottom: 14,
  };
  const inputStyle = {
    padding: "7px 10px",
    border: "1.5px solid #e2e8f0",
    borderRadius: 6,
    fontSize: 13,
    width: "100%",
    fontFamily: "inherit",
  };

  return (
    <div style={{ padding: "16px 20px", maxWidth: 980, margin: "0 auto" }}>
      {/* Header */}
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
        <div style={{ fontSize: 20, fontWeight: 700, color: "#1e293b" }}>
          👥 User Management
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {missingMembers.length > 0 && (
            <button
              onClick={handleBulkCreate}
              disabled={!!bulkStatus}
              style={{
                padding: "7px 16px",
                background: "#16a34a",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              {bulkStatus ||
                `⚡ Create All ${missingMembers.length} Missing Members`}
            </button>
          )}
          <button
            onClick={() => {
              setShowCreate(true);
              setCreateErr("");
            }}
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
            + Create User
          </button>
        </div>
      </div>

      {/* Hierarchy legend */}
      <div
        style={{
          ...boxStyle,
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          padding: "10px 16px",
        }}
      >
        {(
          [
            ["admin", "👑", "Admin — sees all tasks"],
            ["manager", "👔", "Manager — sees own + their team's tasks"],
            ["employee", "👤", "Employee — sees own tasks only"],
          ] as [RoleKey, string, string][]
        ).map(([r, icon, desc]) => (
          <div
            key={r}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
            }}
          >
            <span
              style={{
                background: ROLE_COLORS[r],
                color: ROLE_TEXT[r],
                padding: "2px 8px",
                borderRadius: 4,
                fontWeight: 700,
                fontSize: 11,
              }}
            >
              {icon} {r}
            </span>
            <span style={{ color: "#64748b" }}>{desc}</span>
          </div>
        ))}
      </div>

      {/* Users table */}
      <div style={boxStyle}>
        <div style={{ overflowX: "auto" }}>
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
              {profiles.map((p: UserProfile) => {
                const name = p.full_name || p.email || "?";
                const color = AVATAR_COLORS[name] || "#64748b";
                // Support both old manager_id and new manager_ids array
                const mgrIds = p.manager_ids?.length
                  ? p.manager_ids
                  : p.manager_id
                    ? [p.manager_id]
                    : [];
                const mgrNames = mgrIds
                  .map((id: string) => {
                    const m = profiles.find((x: UserProfile) => x.id === id);
                    return m ? m.full_name || m.email : null;
                  })
                  .filter(Boolean);
                const mgrDisplay = mgrNames.length ? mgrNames.join(", ") : "—";

                return (
                  <tr key={p.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "10px 12px" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
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
                          background:
                            ROLE_COLORS[(p.role || "employee") as RoleKey],
                          color: ROLE_TEXT[(p.role || "employee") as RoleKey],
                        }}
                      >
                        {p.role === "admin"
                          ? "👑"
                          : p.role === "manager"
                            ? "👔"
                            : "👤"}{" "}
                        {p.role || "employee"}
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
                        value={p.role || "employee"}
                        disabled={updating === p.id}
                        onChange={(e) => handleRoleChange(p.id, e.target.value)}
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
                          style={{
                            fontSize: 11,
                            color: "#64748b",
                            marginLeft: 6,
                          }}
                        >
                          Saving…
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      {(p.role === "employee" || p.role === "manager") && (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <MultiManagerSelect
                            options={managers.filter((m) => m.id !== p.id)}
                            selected={mgrIds}
                            disabled={updating === p.id + "-mgr"}
                            onChange={(ids) => handleManagerChange(p.id, ids)}
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
                        onClick={() => openReset(p)}
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
                    <td style={{ padding: "10px 12px", textAlign: "center" }}>
                      {p.role !== "admin" ? (
                        <button
                          onClick={() => toggleInvoiceAccess(p.id)}
                          style={{
                            padding: "4px 12px",
                            borderRadius: 20,
                            border: "none",
                            cursor: "pointer",
                            fontSize: 12,
                            fontWeight: 700,
                            background: invoiceAccess.includes(p.id)
                              ? "#16a34a"
                              : "#e2e8f0",
                            color: invoiceAccess.includes(p.id)
                              ? "#fff"
                              : "#64748b",
                          }}
                        >
                          {invoiceAccess.includes(p.id)
                            ? "✅ Enabled"
                            : "○ Disabled"}
                        </button>
                      ) : (
                        <span style={{ fontSize: 11, color: "#94a3b8" }}>
                          Always On
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "center" }}>
                      {p.role !== "admin" ? (
                        <button
                          onClick={() => toggleNoticeAccess(p.id)}
                          style={{
                            padding: "4px 12px",
                            borderRadius: 20,
                            border: "none",
                            cursor: "pointer",
                            fontSize: 12,
                            fontWeight: 700,
                            background: noticeAccess.includes(p.id)
                              ? "#7c3aed"
                              : "#e2e8f0",
                            color: noticeAccess.includes(p.id)
                              ? "#fff"
                              : "#64748b",
                          }}
                        >
                          {noticeAccess.includes(p.id)
                            ? "✅ Enabled"
                            : "○ Disabled"}
                        </button>
                      ) : (
                        <span style={{ fontSize: 11, color: "#94a3b8" }}>
                          Always On
                        </span>
                      )}
                    </td>
                    {/* Delete */}
                    <td style={{ padding: "10px 12px", textAlign: "center" }}>
                      {p.role !== "admin" ? (
                        <button
                          onClick={() => {
                            setDeleteTarget(p);
                            setDeleteConfirm("");
                            setDeleteErr("");
                          }}
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
                        <span style={{ fontSize: 11, color: "#94a3b8" }}>
                          —
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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

      {/* ── Reset Password Modal ── */}
      {resetTarget && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => !resetBusy && setResetTarget(null)}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              padding: 28,
              width: 400,
              maxWidth: "94vw",
              boxShadow: "0 20px 60px rgba(0,0,0,.3)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>
              🔑 Reset Password
            </div>
            <div style={{ fontSize: 13, color: "#64748b", marginBottom: 20 }}>
              User:{" "}
              <strong>{resetTarget.full_name || resetTarget.email}</strong>
            </div>

            {resetSuccess ? (
              <div
                style={{
                  background: "#f0fdf4",
                  border: "1px solid #bbf7d0",
                  borderRadius: 8,
                  padding: "14px 16px",
                  fontSize: 13,
                  color: "#16a34a",
                  fontWeight: 600,
                  marginBottom: 16,
                }}
              >
                {resetSuccess}
              </div>
            ) : (
              <form
                onSubmit={handleResetPassword}
                style={{ display: "flex", flexDirection: "column", gap: 14 }}
              >
                <div>
                  <label
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#64748b",
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                    }}
                  >
                    New Password
                  </label>
                  <input
                    type="text"
                    value={resetPwd}
                    onChange={(e) => setResetPwd(e.target.value)}
                    autoFocus
                    style={{
                      padding: "8px 10px",
                      border: "1.5px solid #e2e8f0",
                      borderRadius: 6,
                      fontSize: 13,
                      width: "100%",
                      fontFamily: "inherit",
                      marginTop: 4,
                      boxSizing: "border-box",
                    }}
                    required
                    minLength={6}
                  />
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3 }}>
                    Minimum 6 characters
                  </div>
                </div>
                {resetErr && (
                  <p
                    style={{
                      color: "#dc2626",
                      fontSize: 12,
                      background: "#fee2e2",
                      padding: "8px 12px",
                      borderRadius: 6,
                      margin: 0,
                    }}
                  >
                    {resetErr}
                  </p>
                )}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: 10,
                    marginTop: 4,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setResetTarget(null)}
                    disabled={resetBusy}
                    style={{
                      padding: "8px 16px",
                      border: "1px solid #e2e8f0",
                      borderRadius: 6,
                      cursor: "pointer",
                      fontSize: 13,
                      background: "#f8fafc",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={resetBusy}
                    style={{
                      padding: "8px 18px",
                      background: "#d97706",
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      cursor: "pointer",
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                    {resetBusy ? "Resetting…" : "Set Password"}
                  </button>
                </div>
              </form>
            )}

            {resetSuccess && (
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  onClick={() => setResetTarget(null)}
                  style={{
                    padding: "8px 18px",
                    background: "#2563eb",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontWeight: 600,
                    fontSize: 13,
                  }}
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Delete User Confirmation Modal ── */}
      {deleteTarget && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => {
            if (!deleteBusy) setDeleteTarget(null);
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              padding: 28,
              width: 420,
              maxWidth: "94vw",
              boxShadow: "0 20px 60px rgba(0,0,0,.3)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                fontSize: 17,
                fontWeight: 700,
                marginBottom: 6,
                color: "#dc2626",
              }}
            >
              🗑 Delete User
            </div>
            <div style={{ fontSize: 13, color: "#475569", marginBottom: 18 }}>
              You are about to permanently delete{" "}
              <strong>{deleteTarget.full_name || deleteTarget.email}</strong>.
              This cannot be undone.
            </div>
            <div style={{ marginBottom: 14 }}>
              <label
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#dc2626",
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  display: "block",
                  marginBottom: 4,
                }}
              >
                Type the user's name to confirm
              </label>
              <input
                autoFocus
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                placeholder={deleteTarget.full_name || deleteTarget.email}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  border: "2px solid #fecaca",
                  borderRadius: 6,
                  fontSize: 13,
                  boxSizing: "border-box",
                  outline: "none",
                  fontFamily: "inherit",
                }}
              />
            </div>
            {deleteErr && (
              <div
                style={{
                  padding: "8px 12px",
                  background: "#fff1f2",
                  border: "1px solid #fecaca",
                  borderRadius: 6,
                  color: "#dc2626",
                  fontSize: 12,
                  marginBottom: 12,
                }}
              >
                {deleteErr}
              </div>
            )}
            <div
              style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}
            >
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleteBusy}
                style={{
                  padding: "8px 18px",
                  border: "1px solid #e2e8f0",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 13,
                  background: "#f8fafc",
                  fontWeight: 600,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteUser}
                disabled={
                  deleteBusy ||
                  deleteConfirm !==
                    (deleteTarget.full_name || deleteTarget.email)
                }
                style={{
                  padding: "8px 18px",
                  background: "#dc2626",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: 13,
                  opacity:
                    deleteBusy ||
                    deleteConfirm !==
                      (deleteTarget.full_name || deleteTarget.email)
                      ? 0.5
                      : 1,
                }}
              >
                {deleteBusy ? "Deleting…" : "🗑 Permanently Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create User Modal ── */}
      {showCreate && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setShowCreate(false)}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              padding: 28,
              width: 440,
              maxWidth: "94vw",
              boxShadow: "0 20px 60px rgba(0,0,0,.3)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 20 }}>
              ➕ Create New User
            </div>
            <form
              onSubmit={handleCreate}
              style={{ display: "flex", flexDirection: "column", gap: 14 }}
            >
              <div>
                <label
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#64748b",
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  Username{" "}
                  <span style={{ color: "#94a3b8", fontWeight: 400 }}>
                    (optional if email provided)
                  </span>
                </label>
                <input
                  type="text"
                  value={form.username}
                  onChange={(e) => set("username", e.target.value)}
                  placeholder="e.g. tamil"
                  style={{ ...inputStyle, marginTop: 4 }}
                />
              </div>

              <div>
                <label
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#64748b",
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  Email{" "}
                  <span style={{ color: "#94a3b8", fontWeight: 400 }}>
                    (optional if username provided)
                  </span>
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="e.g. tamil@company.com"
                  style={{ ...inputStyle, marginTop: 4 }}
                />
              </div>

              <div>
                <label
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#64748b",
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  Password
                </label>
                <input
                  type="text"
                  value={form.password}
                  onChange={(e) => set("password", e.target.value)}
                  style={{ ...inputStyle, marginTop: 4 }}
                  required
                  minLength={6}
                />
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3 }}>
                  Default: 123456
                </div>
              </div>

              <div>
                <label
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#64748b",
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  Role
                </label>
                <select
                  value={form.role}
                  onChange={(e) => set("role", e.target.value)}
                  style={{ ...inputStyle, marginTop: 4 }}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r.charAt(0).toUpperCase() + r.slice(1)}
                    </option>
                  ))}
                </select>
              </div>

              {(form.role === "employee" || form.role === "manager") && (
                <div>
                  <label
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#64748b",
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                    }}
                  >
                    Reports To (Manager)
                  </label>
                  <select
                    value={form.manager_id}
                    onChange={(e) => set("manager_id", e.target.value)}
                    style={{ ...inputStyle, marginTop: 4 }}
                  >
                    <option value="">— None —</option>
                    {managers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.full_name || m.email}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {createErr && (
                <p
                  style={{
                    color: "#dc2626",
                    fontSize: 12,
                    background: "#fee2e2",
                    padding: "8px 12px",
                    borderRadius: 6,
                    margin: 0,
                  }}
                >
                  {createErr}
                </p>
              )}

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 10,
                  marginTop: 4,
                }}
              >
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  style={{
                    padding: "8px 16px",
                    border: "1px solid #e2e8f0",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 13,
                    background: "#f8fafc",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  style={{
                    padding: "8px 18px",
                    background: "#2563eb",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontWeight: 600,
                    fontSize: 13,
                  }}
                >
                  {creating ? "Creating…" : "Create User"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
