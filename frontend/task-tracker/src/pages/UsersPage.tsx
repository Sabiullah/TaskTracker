import { useState, type CSSProperties, type FormEvent } from "react";
import { ApiError, apiPatch, apiPost } from "@/lib/api";
import { adminCreateUser } from "@/lib/adminApi";
import UserTable from "@/components/users/UserTable";
import type { Profile } from "@/types";
import type {
  OkResponse,
  PasswordResetRequest,
  ProfileUpdate,
  RoleValue,
  Uid,
  UserDeleteRequest,
} from "@/types/api";
import { getLiveMembers } from "@/utils/masters";
import { ROLE_COLORS, ROLE_TEXT, ROLES } from "@/utils/users";

interface UsersPageProps {
  profiles: Profile[];
  onRefresh: () => void;
}

type AccessFlag =
  | "invoice_access"
  | "notice_access"
  | "masters_access"
  | "attendance_access"
  | "employee_access";

interface CreateForm {
  username: string;
  password: string;
  role: RoleValue;
  manager_id: string;
}

const DEFAULT_PASSWORD = "123456";
const FALLBACK_DOMAIN = "@tasktracker.local";

function buildEmail(username: string): string {
  const trimmed = username.trim();
  if (trimmed.includes("@")) return trimmed;
  return `${trimmed.toLowerCase().replace(/\s+/g, ".")}${FALLBACK_DOMAIN}`;
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Unknown error";
}

export default function UsersPage({ profiles, onRefresh }: UsersPageProps) {
  const [updating, setUpdating] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState("");
  const [bulkStatus, setBulkStatus] = useState("");
  const [form, setForm] = useState<CreateForm>({
    username: "",
    password: DEFAULT_PASSWORD,
    role: "employee",
    manager_id: "",
  });

  // Password reset state
  const [resetTarget, setResetTarget] = useState<Profile | null>(null);
  const [resetPwd, setResetPwd] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetErr, setResetErr] = useState("");
  const [resetSuccess, setResetSuccess] = useState("");

  // Delete user state
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState("");

  const patchProfile = async (
    userId: Uid,
    body: ProfileUpdate,
  ): Promise<boolean> => {
    try {
      await apiPatch(`/users/${userId}/`, body);
      return true;
    } catch (err) {
      alert(`Update failed: ${errorMessage(err)}`);
      return false;
    }
  };

  const toggleAccess = async (userId: Uid, flag: AccessFlag): Promise<void> => {
    const target = profiles.find((p) => p.id === userId);
    if (!target) return;
    const current = target[flag];
    setUpdating(`${userId}-${flag}`);
    const ok = await patchProfile(userId, { [flag]: !current });
    setUpdating(null);
    if (ok) onRefresh();
  };

  const handleDeleteUser = async (): Promise<void> => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteErr("");
    try {
      const body: UserDeleteRequest = { user_uid: deleteTarget.id };
      await apiPost<OkResponse>("/users/delete/", body);
      setDeleteTarget(null);
      setDeleteConfirm("");
      onRefresh();
    } catch (err) {
      setDeleteErr(errorMessage(err));
    } finally {
      setDeleteBusy(false);
    }
  };

  const setFormField = <K extends keyof CreateForm>(
    key: K,
    value: CreateForm[K],
  ): void => setForm((f) => ({ ...f, [key]: value }));

  const allMembers = getLiveMembers();
  const managers = profiles.filter(
    (p) => p.role === "admin" || p.role === "manager",
  );
  const existingNames = profiles.map((p) => (p.full_name || "").toLowerCase());
  const missingMembers = allMembers.filter(
    (m) => !existingNames.includes(m.toLowerCase()),
  );

  const handleCreate = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!form.username) {
      setCreateErr("Please select a username.");
      return;
    }
    setCreating(true);
    setCreateErr("");
    const result = await adminCreateUser({
      username: form.username,
      email: buildEmail(form.username),
      password: form.password || DEFAULT_PASSWORD,
      fullName: form.username,
      role: form.role,
      managerUid: form.manager_id || null,
    });
    setCreating(false);
    if (result.error) {
      setCreateErr(result.error.message);
      return;
    }
    setShowCreate(false);
    setForm({
      username: "",
      password: DEFAULT_PASSWORD,
      role: "employee",
      manager_id: "",
    });
    onRefresh();
  };

  const handleBulkCreate = async (): Promise<void> => {
    if (missingMembers.length === 0) {
      alert("All team members already have accounts!");
      return;
    }
    if (
      !window.confirm(
        `Create accounts for ${missingMembers.length} team members?\n\n${missingMembers.join(", ")}\n\nDefault password: ${DEFAULT_PASSWORD}`,
      )
    )
      return;

    setBulkStatus("Creating…");
    let done = 0;
    const failed: string[] = [];
    for (const name of missingMembers) {
      const result = await adminCreateUser({
        username: name,
        email: buildEmail(name),
        password: DEFAULT_PASSWORD,
        fullName: name,
        role: "employee",
      });
      if (result.error) failed.push(`${name}: ${result.error.message}`);
      else done++;
      setBulkStatus(`Creating… ${done}/${missingMembers.length}`);
    }
    setBulkStatus("");
    if (failed.length)
      alert(`Created ${done} users.\n\nFailed:\n${failed.join("\n")}`);
    else
      alert(
        `✅ Successfully created ${done} user accounts!\n\nAll with password: ${DEFAULT_PASSWORD}\nYou can now assign roles and managers.`,
      );
    onRefresh();
  };

  const openReset = (p: Profile): void => {
    setResetTarget(p);
    setResetPwd(DEFAULT_PASSWORD);
    setResetErr("");
    setResetSuccess("");
  };

  const handleResetPassword = async (
    e: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    e.preventDefault();
    if (!resetTarget) return;
    if (resetPwd.length < 6) {
      setResetErr("Password must be at least 6 characters.");
      return;
    }
    setResetBusy(true);
    setResetErr("");
    setResetSuccess("");
    try {
      const body: PasswordResetRequest = {
        user_uid: resetTarget.id,
        new_password: resetPwd,
      };
      await apiPost<OkResponse>("/users/reset-password/", body);
      setResetSuccess(
        `✅ Password updated for ${resetTarget.full_name || resetTarget.email}`,
      );
    } catch (err) {
      setResetErr(errorMessage(err));
    } finally {
      setResetBusy(false);
    }
  };

  const handleRoleChange = async (
    userId: string,
    newRole: string,
  ): Promise<void> => {
    setUpdating(userId);
    const ok = await patchProfile(userId, { role: newRole as RoleValue });
    setUpdating(null);
    if (ok) onRefresh();
  };

  const handleManagerChange = async (
    userId: string,
    managerIds: string[],
  ): Promise<void> => {
    setUpdating(userId + "-mgr");
    const ok = await patchProfile(userId, { manager_ids: managerIds });
    setUpdating(null);
    if (ok) onRefresh();
  };

  const boxStyle: CSSProperties = {
    background: "#fff",
    borderRadius: 10,
    padding: 16,
    boxShadow: "0 1px 4px rgba(0,0,0,.08)",
    marginBottom: 14,
  };
  const inputStyle: CSSProperties = {
    padding: "7px 10px",
    border: "1.5px solid #e2e8f0",
    borderRadius: 6,
    fontSize: 13,
    width: "100%",
    fontFamily: "inherit",
  };

  return (
    <div style={{ padding: "16px 20px" }}>
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
        <div className="page-title">👥 User Management</div>
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
          ] as const
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
        <UserTable
          profiles={profiles}
          updating={updating}
          onRoleChange={handleRoleChange}
          onManagerChange={handleManagerChange}
          onToggleInvoice={(id) => toggleAccess(id, "invoice_access")}
          onToggleNotice={(id) => toggleAccess(id, "notice_access")}
          onToggleMasters={(id) => toggleAccess(id, "masters_access")}
          onToggleAttendance={(id) => toggleAccess(id, "attendance_access")}
          onToggleEmployee={(id) => toggleAccess(id, "employee_access")}
          onOpenReset={openReset}
          onOpenDelete={(p) => {
            setDeleteTarget(p);
            setDeleteConfirm("");
            setDeleteErr("");
          }}
        />
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
              This cannot be undone. All their auth credentials will be removed.
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
                Type the user&apos;s name to confirm
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
                  Username (Responsible Person)
                </label>
                <select
                  value={form.username}
                  onChange={(e) => setFormField("username", e.target.value)}
                  style={{ ...inputStyle, marginTop: 4 }}
                  required
                >
                  <option value="">— Select member —</option>
                  {allMembers.map((m) => (
                    <option
                      key={m}
                      value={m}
                      disabled={existingNames.includes(m.toLowerCase())}
                    >
                      {m}
                      {existingNames.includes(m.toLowerCase())
                        ? " (already exists)"
                        : ""}
                    </option>
                  ))}
                </select>
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
                  onChange={(e) => setFormField("password", e.target.value)}
                  style={{ ...inputStyle, marginTop: 4 }}
                  required
                  minLength={6}
                />
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3 }}>
                  Default: {DEFAULT_PASSWORD}
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
                  onChange={(e) =>
                    setFormField("role", e.target.value as RoleValue)
                  }
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
                    onChange={(e) => setFormField("manager_id", e.target.value)}
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
