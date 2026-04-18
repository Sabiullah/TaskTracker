import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
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
import { useMasters } from "@/hooks/useMasters";
import { useAuth } from "@/hooks/useAuth";
import { ROLES } from "@/utils/users";

interface UsersPageProps {
  profiles: Profile[];
  onRefresh: () => void;
  /** Org uid from the header filter (empty = "All Orgs"). When set, only
   *  users with a membership in that org are shown. */
  selectedOrg?: string;
}

type AccessFlag =
  | "invoice_access"
  | "notice_access"
  | "masters_access"
  | "attendance_access"
  | "employee_access";

interface CreateForm {
  /** Display name shown across the app (e.g. "Aravindh K"). */
  fullName: string;
  /** Login slug derived from fullName by default, editable. */
  username: string;
  password: string;
  role: RoleValue;
  manager_id: string;
  /** Org uid the new user (or new membership) lands in. */
  org_uid: string;
}

const DEFAULT_PASSWORD = "123456";
const FALLBACK_DOMAIN = "@tasktracker.local";

function slugifyUsername(fullName: string): string {
  return fullName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

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

export default function UsersPage({
  profiles: allProfiles,
  onRefresh,
  selectedOrg = "",
}: UsersPageProps) {
  // Header org filter narrows the visible user list. Empty = show all.
  const profiles = useMemo(
    () =>
      selectedOrg
        ? allProfiles.filter((p) =>
            p.orgs.some((o) => o.uid === selectedOrg),
          )
        : allProfiles,
    [allProfiles, selectedOrg],
  );

  // Page-level search across full_name / username / email. Kept on the page
  // (not in UserTable) so the header counter can reflect it.
  const [search, setSearch] = useState("");
  // Role filter chip selection. ``""`` = all roles. Matches the user's
  // ``highest_role`` (which is already the best-role-across-orgs summary).
  const [roleFilter, setRoleFilter] = useState<string>("");

  const filteredProfiles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return profiles.filter((p) => {
      if (roleFilter && (p.highest_role || "employee") !== roleFilter) {
        return false;
      }
      if (!q) return true;
      return [p.full_name, p.username, p.email]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(q));
    });
  }, [profiles, search, roleFilter]);

  // Role counts power the stat strip + chip labels. Built from the
  // org-scoped ``profiles`` (not the search-filtered set) so chip counts
  // stay stable while you type in the search box.
  const roleCounts = useMemo(() => {
    const counts = { admin: 0, manager: 0, employee: 0 };
    for (const p of profiles) {
      const r = (p.highest_role || "employee") as keyof typeof counts;
      counts[r] = (counts[r] ?? 0) + 1;
    }
    return counts;
  }, [profiles]);

  // Caller is admin in at least one of these orgs (UsersPage is admin-only).
  // Used to populate the Org picker on the Create User modal — the backend
  // requires an org identifier whenever the caller belongs to >1 org.
  const { orgs: callerOrgs, isAdminIn } = useAuth();
  const adminOrgs = useMemo(
    () => callerOrgs.filter((o) => isAdminIn(o)),
    [callerOrgs, isAdminIn],
  );
  const defaultOrgUid = adminOrgs[0]?.uid ?? "";

  const [updating, setUpdating] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState("");
  const [form, setForm] = useState<CreateForm>({
    fullName: "",
    username: "",
    password: DEFAULT_PASSWORD,
    role: "employee",
    manager_id: "",
    org_uid: defaultOrgUid,
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

  const { team: teamMasters } = useMasters();

  // Every user has at most one login in this internal app, but the caller
  // may only see users sharing an org. Pull the *global* name list from a
  // lightweight admin-only endpoint so the Create User dropdown hides team
  // members who already have an account in ANY org.
  const [globalNames, setGlobalNames] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await apiGet<
          { username: string; full_name: string; email: string }[]
        >("/users/existing_names/");
        if (cancelled) return;
        const set = new Set<string>();
        for (const r of rows) {
          const fn = (r.full_name || "").trim().toLowerCase();
          const un = (r.username || "").trim().toLowerCase();
          if (fn) set.add(fn);
          if (un) set.add(un);
        }
        setGlobalNames(set);
      } catch {
        /* keep empty set; dropdown will show everything — backend will
           still reject duplicates on submit, so no data integrity risk */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allProfiles]);
  const allMembers = useMemo(
    () =>
      [...new Set(teamMasters.map((t) => t.name))]
        .filter((m) => !globalNames.has(m.trim().toLowerCase()))
        .sort((a, b) => a.localeCompare(b)),
    [teamMasters, globalNames],
  );
  const managers = profiles.filter(
    (p) => p.highest_role === "admin" || p.highest_role === "manager",
  );

  const handleCreate = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const fullName = form.fullName.trim();
    if (!fullName) {
      setCreateErr("Please select a full name.");
      return;
    }
    const username = (form.username || slugifyUsername(fullName)).trim();
    if (!username) {
      setCreateErr("Username is required.");
      return;
    }
    const orgUid = form.org_uid || defaultOrgUid;
    if (!orgUid) {
      setCreateErr(
        "You are not an admin of any organisation \u2014 cannot create users.",
      );
      return;
    }
    setCreating(true);
    setCreateErr("");
    const result = await adminCreateUser({
      username,
      email: buildEmail(username),
      password: form.password || DEFAULT_PASSWORD,
      fullName,
      role: form.role,
      managerUid: form.manager_id || null,
      orgUid,
    });
    setCreating(false);
    if (result.error) {
      setCreateErr(result.error.message);
      return;
    }
    setShowCreate(false);
    setForm({
      fullName: "",
      username: "",
      password: DEFAULT_PASSWORD,
      role: "employee",
      manager_id: "",
      org_uid: defaultOrgUid,
    });
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

  const handleManagerChange = async (
    userId: string,
    managerIds: string[],
  ): Promise<void> => {
    setUpdating(userId + "-mgr");
    const ok = await patchProfile(userId, { manager_ids: managerIds });
    setUpdating(null);
    if (ok) onRefresh();
  };

  // ── Per-org membership editors (pill chips on the user row) ──────────────
  const handleAddOrg = async (
    userId: string,
    orgUid: string,
  ): Promise<void> => {
    setUpdating(`${userId}-add-org`);
    const org = adminOrgs.find((o) => o.uid === orgUid);
    const ok = await patchProfile(userId, {
      org: orgUid,
      role: "employee" as RoleValue,
    });
    setUpdating(null);
    if (ok) {
      onRefresh();
      if (org) {
        alert(
          `Added to ${org.name} as Employee. Change the role in the Role column if needed.`,
        );
      }
    }
  };

  const handleSetDefaultOrg = async (
    userId: string,
    orgUid: string,
  ): Promise<void> => {
    setUpdating(`${userId}-org-${orgUid}`);
    const ok = await patchProfile(userId, {
      org: orgUid,
      is_default: true,
    });
    setUpdating(null);
    if (ok) onRefresh();
  };

  const handleRemoveOrg = async (
    userId: string,
    orgUid: string,
    orgName: string,
  ): Promise<void> => {
    const target = allProfiles.find((p) => p.id === userId);
    if (!target) return;
    if (
      !window.confirm(
        `Remove ${target.full_name || target.email} from ${orgName}? Their role and access flags for this org will be discarded.`,
      )
    )
      return;
    setUpdating(`${userId}-org-${orgUid}`);
    try {
      await apiDelete(`/users/${userId}/memberships/${orgUid}/`);
      onRefresh();
    } catch (err) {
      alert(`Remove failed: ${errorMessage(err)}`);
    } finally {
      setUpdating(null);
    }
  };

  // Per-org role/access editors (used by the org-pill popover in the table).
  // These send the specific org uid, so they edit the correct membership
  // regardless of which one is flagged default.
  const handleSetOrgRole = async (
    userId: string,
    orgUid: string,
    role: string,
  ): Promise<void> => {
    setUpdating(`${userId}-org-${orgUid}`);
    const ok = await patchProfile(userId, {
      org: orgUid,
      role: role as RoleValue,
    });
    setUpdating(null);
    if (ok) onRefresh();
  };

  const handleToggleOrgAccess = async (
    userId: string,
    orgUid: string,
    key: AccessFlag,
    enabled: boolean,
  ): Promise<void> => {
    setUpdating(`${userId}-org-${orgUid}`);
    const ok = await patchProfile(userId, {
      org: orgUid,
      [key]: enabled,
    });
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
          gap: 12,
        }}
      >
        <div>
          <div className="page-title" style={{ marginBottom: 2 }}>
            👥 User Management
          </div>
          <div style={{ fontSize: 12, color: "#64748b" }}>
            {filteredProfiles.length}
            {filteredProfiles.length !== profiles.length &&
              ` of ${profiles.length}`}{" "}
            user{filteredProfiles.length === 1 ? "" : "s"}
            {selectedOrg &&
              callerOrgs.find((o) => o.uid === selectedOrg) &&
              ` in ${callerOrgs.find((o) => o.uid === selectedOrg)?.name}`}
          </div>
        </div>
        <div
          style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
        >
          <div style={{ position: "relative" }}>
            <input
              type="search"
              placeholder="Search name, username, email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                padding: "7px 10px 7px 30px",
                border: "1.5px solid #e2e8f0",
                borderRadius: 6,
                fontSize: 13,
                width: 260,
                fontFamily: "inherit",
              }}
            />
            <span
              aria-hidden
              style={{
                position: "absolute",
                left: 10,
                top: "50%",
                transform: "translateY(-50%)",
                fontSize: 13,
                color: "#94a3b8",
                pointerEvents: "none",
              }}
            >
              🔍
            </span>
          </div>
          <details style={{ position: "relative" }}>
            <summary
              style={{
                listStyle: "none",
                padding: "7px 12px",
                border: "1px solid #e2e8f0",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 12,
                color: "#475569",
                background: "#fff",
                userSelect: "none",
              }}
              title="Show role legend"
            >
              ? Roles
            </summary>
            <div
              style={{
                position: "absolute",
                right: 0,
                top: "calc(100% + 4px)",
                background: "#fff",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                padding: "10px 14px",
                boxShadow: "0 4px 16px rgba(0,0,0,.08)",
                fontSize: 12,
                lineHeight: 1.6,
                zIndex: 10,
                minWidth: 280,
              }}
            >
              <div>
                <strong>👑 Admin</strong> — sees all tasks in the org
              </div>
              <div>
                <strong>👔 Manager</strong> — sees own + their team&apos;s tasks
              </div>
              <div>
                <strong>👤 Employee</strong> — sees own tasks only
              </div>
            </div>
          </details>
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

      {/* Stats strip + role filter chips */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        {(
          [
            { key: "", label: "All", count: profiles.length, color: "#2563eb" },
            {
              key: "admin",
              label: "👑 Admins",
              count: roleCounts.admin,
              color: "#1d4ed8",
            },
            {
              key: "manager",
              label: "👔 Managers",
              count: roleCounts.manager,
              color: "#92400e",
            },
            {
              key: "employee",
              label: "👤 Employees",
              count: roleCounts.employee,
              color: "#475569",
            },
          ] as const
        ).map((chip) => {
          const active = roleFilter === chip.key;
          return (
            <button
              key={chip.key || "all"}
              type="button"
              onClick={() => setRoleFilter(chip.key)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                borderRadius: 999,
                border: `1px solid ${active ? chip.color : "#e2e8f0"}`,
                background: active ? chip.color : "#fff",
                color: active ? "#fff" : "#475569",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
                transition: "all .12s",
              }}
            >
              <span>{chip.label}</span>
              <span
                style={{
                  padding: "1px 7px",
                  borderRadius: 999,
                  background: active
                    ? "rgba(255,255,255,.22)"
                    : "#f1f5f9",
                  color: active ? "#fff" : "#475569",
                  fontWeight: 700,
                  fontSize: 11,
                  minWidth: 18,
                  textAlign: "center",
                }}
              >
                {chip.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Users table */}
      <div style={boxStyle}>
        <UserTable
          profiles={filteredProfiles}
          updating={updating}
          adminOrgs={adminOrgs.map((o) => ({ uid: o.uid, name: o.name }))}
          onManagerChange={handleManagerChange}
          onOpenReset={openReset}
          onOpenDelete={(p) => {
            setDeleteTarget(p);
            setDeleteConfirm("");
            setDeleteErr("");
          }}
          onAddOrg={(userId, orgUid) => {
            void handleAddOrg(userId, orgUid);
          }}
          onSetDefaultOrg={(userId, orgUid) => {
            void handleSetDefaultOrg(userId, orgUid);
          }}
          onRemoveOrg={(userId, orgUid, orgName) => {
            void handleRemoveOrg(userId, orgUid, orgName);
          }}
          onSetOrgRole={(userId, orgUid, role) => {
            void handleSetOrgRole(userId, orgUid, role);
          }}
          onToggleOrgAccess={(userId, orgUid, key, enabled) => {
            void handleToggleOrgAccess(userId, orgUid, key, enabled);
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
                  Full Name (Team Member)
                </label>
                <select
                  value={form.fullName}
                  onChange={(e) => {
                    const fn = e.target.value;
                    setForm((f) => ({
                      ...f,
                      fullName: fn,
                      // Auto-fill the username slug when the user hasn't
                      // overridden it, or when they clear the selection.
                      username: slugifyUsername(fn),
                    }));
                  }}
                  style={{ ...inputStyle, marginTop: 4 }}
                  required
                >
                  <option value="">— Select member —</option>
                  {allMembers.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                {allMembers.length === 0 && (
                  <div
                    style={{ fontSize: 11, color: "#94a3b8", marginTop: 3 }}
                  >
                    Every team member already has an account. Add a new
                    member from the Masters page first.
                  </div>
                )}
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
                  Username (for login)
                </label>
                <input
                  type="text"
                  value={form.username}
                  onChange={(e) => setFormField("username", e.target.value)}
                  placeholder="e.g. aravindh.k"
                  style={{ ...inputStyle, marginTop: 4 }}
                  required
                />
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3 }}>
                  Auto-filled from the full name. Edit if you want a
                  different login slug — lowercase letters, digits, and dots
                  only.
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

              {adminOrgs.length > 1 && (
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
                    Organisation
                  </label>
                  <select
                    value={form.org_uid}
                    onChange={(e) => setFormField("org_uid", e.target.value)}
                    style={{ ...inputStyle, marginTop: 4 }}
                    required
                  >
                    {adminOrgs.map((o) => (
                      <option key={o.uid} value={o.uid}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3 }}>
                    User will be added to this org. If they already have an
                    account in another org, a membership is added there.
                  </div>
                </div>
              )}

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
