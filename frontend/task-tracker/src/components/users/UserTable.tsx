import type { CSSProperties } from "react";
import { avatarColor } from "@/utils/avatar";
import MultiManagerSelect from "./MultiManagerSelect";
import OrgPillMenu from "./OrgPillMenu";
import type { Profile } from "@/types";

export interface OrgOption {
  readonly uid: string;
  readonly name: string;
}

const th: CSSProperties = {
  padding: "10px 14px",
  textAlign: "left",
  fontWeight: 700,
  color: "#475569",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.6,
  borderBottom: "2px solid #e2e8f0",
  whiteSpace: "nowrap",
  background: "#f8fafc",
};

const td: CSSProperties = {
  padding: "12px 14px",
  verticalAlign: "middle",
  fontSize: 13,
};

export interface UserTableProps {
  profiles: Profile[];
  updating: string | null;
  /** Orgs the caller is admin in — used to populate the "+ Add to org"
   *  picker. Rows only offer orgs the target user isn't already in. */
  adminOrgs: readonly OrgOption[];
  onManagerChange: (userId: string, managerIds: string[]) => void;
  onOpenReset: (p: Profile) => void;
  onOpenDelete: (p: Profile) => void;
  /** Add ``orgUid`` to ``userId`` as an employee membership. */
  onAddOrg: (userId: string, orgUid: string) => void;
  /** Flip ``is_default`` to the chosen membership. */
  onSetDefaultOrg: (userId: string, orgUid: string) => void;
  /** Remove the user from that org. Backend refuses if it's the only one. */
  onRemoveOrg: (userId: string, orgUid: string, orgName: string) => void;
  /** Change role on a specific org membership (not just the default org). */
  onSetOrgRole: (userId: string, orgUid: string, role: string) => void;
  /** Toggle an access flag on a specific org membership. */
  onToggleOrgAccess: (
    userId: string,
    orgUid: string,
    key:
      | "invoice_access"
      | "notice_access"
      | "masters_access"
      | "attendance_access"
      | "employee_access",
    enabled: boolean,
  ) => void;
}

/**
 * Decides whether ``candidate`` can be listed as a manager for ``target``.
 * Internal rule (this is a non-multi-tenant internal app): a manager must
 * be a member of AT LEAST ONE org the target also belongs to, and must
 * hold admin or manager role in at least one of those shared orgs.
 */
function canManage(target: Profile, candidate: Profile): boolean {
  if (candidate.id === target.id) return false;
  const targetOrgUids = new Set(target.orgs.map((o) => o.uid));
  for (const o of candidate.orgs) {
    if (!targetOrgUids.has(o.uid)) continue;
    if (o.role === "admin" || o.role === "manager") return true;
  }
  return false;
}

export default function UserTable({
  profiles,
  updating,
  adminOrgs,
  onManagerChange,
  onOpenReset,
  onOpenDelete,
  onAddOrg,
  onSetDefaultOrg,
  onRemoveOrg,
  onSetOrgRole,
  onToggleOrgAccess,
}: UserTableProps) {
  return (
    <div className="sticky-table-wrap">
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["User", "Orgs & Access", "Manager", "Actions"].map((h) => (
              <th key={h} style={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {profiles.map((p, i) => {
            const name = p.full_name || p.email || "?";
            const color = avatarColor(name);
            const mgrIds = p.manager_ids?.length ? p.manager_ids : [];
            // Manager candidates: only people who share an org with this
            // user AND hold admin/manager role in that shared org. Keeps
            // reporting lines org-local — the managers menu can't pull in
            // outsiders from an unrelated org.
            const managerOptions = profiles.filter((m) => canManage(p, m));
            const allAdmin =
              p.orgs.length > 0 && p.orgs.every((o) => o.role === "admin");
            const busyMgr = updating === `${p.id}-mgr`;

            return (
              <tr
                key={p.id}
                className="tt-user-row"
                style={{
                  borderBottom: "1px solid #f1f5f9",
                  verticalAlign: "middle",
                  background: i % 2 === 0 ? "#ffffff" : "#fafbfd",
                }}
              >
                {/* User: avatar + full name, with username / email beneath */}
                <td style={{ ...td, minWidth: 240 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: "50%",
                        background: color,
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 13,
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {name.slice(0, 2).toUpperCase()}
                    </div>
                    <div style={{ lineHeight: 1.35, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 700,
                          color: "#1e293b",
                          fontSize: 13,
                        }}
                      >
                        {name}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "#64748b",
                          display: "flex",
                          gap: 6,
                          alignItems: "center",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {p.email && (
                          <span
                            style={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                            title={p.email}
                          >
                            {p.email}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </td>

                {/* Orgs & Access: pill popover per membership.
                    Click a pill to edit that org's role + access flags. */}
                <td style={{ ...td, minWidth: 260 }}>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 4,
                      alignItems: "center",
                    }}
                  >
                    {p.orgs.map((o) => (
                      <OrgPillMenu
                        key={o.uid}
                        org={o}
                        isOnlyOrg={p.orgs.length <= 1}
                        onSetRole={(orgUid, role) =>
                          onSetOrgRole(p.id, orgUid, role)
                        }
                        onToggleAccess={(orgUid, key, enabled) =>
                          onToggleOrgAccess(p.id, orgUid, key, enabled)
                        }
                        onSetDefault={(orgUid) =>
                          onSetDefaultOrg(p.id, orgUid)
                        }
                        onRemove={(orgUid, orgName) =>
                          onRemoveOrg(p.id, orgUid, orgName)
                        }
                      />
                    ))}
                    {adminOrgs.filter(
                      (ao) => !p.orgs.some((o) => o.uid === ao.uid),
                    ).length > 0 && (
                      <select
                        value=""
                        onChange={(e) => {
                          const uid = e.target.value;
                          if (uid) onAddOrg(p.id, uid);
                        }}
                        disabled={updating === `${p.id}-add-org`}
                        title="Add this user to another organisation"
                        style={{
                          padding: "2px 4px",
                          border: "1px dashed #cbd5e1",
                          borderRadius: 999,
                          background: "#fff",
                          fontSize: 11,
                          fontWeight: 600,
                          color: "#2563eb",
                          cursor: "pointer",
                        }}
                      >
                        <option value="">+ Add to org</option>
                        {adminOrgs
                          .filter(
                            (ao) => !p.orgs.some((o) => o.uid === ao.uid),
                          )
                          .map((ao) => (
                            <option key={ao.uid} value={ao.uid}>
                              {ao.name}
                            </option>
                          ))}
                      </select>
                    )}
                    {p.orgs.length === 0 && (
                      <span style={{ fontSize: 11, color: "#94a3b8" }}>
                        No orgs — add one to set role/access
                      </span>
                    )}
                  </div>
                </td>

                {/* Manager: only candidates sharing an org with this user */}
                <td style={td}>
                  {allAdmin ? (
                    <span style={{ fontSize: 11, color: "#94a3b8" }}>
                      —
                    </span>
                  ) : (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <MultiManagerSelect
                        options={managerOptions}
                        selected={mgrIds}
                        disabled={busyMgr}
                        onChange={(ids) => onManagerChange(p.id, ids)}
                      />
                      {busyMgr && (
                        <span style={{ fontSize: 11, color: "#94a3b8" }}>
                          …
                        </span>
                      )}
                      {managerOptions.length === 0 && (
                        <span style={{ fontSize: 11, color: "#94a3b8" }}>
                          No eligible manager in shared orgs
                        </span>
                      )}
                    </div>
                  )}
                </td>

                {/* Actions: reset password + delete as compact icon buttons */}
                <td style={td}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={() => onOpenReset(p)}
                      title={`Reset password for ${name}`}
                      style={{
                        padding: "5px 9px",
                        border: "1px solid #e2e8f0",
                        background: "#f8fafc",
                        borderRadius: 6,
                        cursor: "pointer",
                        fontSize: 12,
                        color: "#475569",
                      }}
                    >
                      🔑
                    </button>
                    {!allAdmin && (
                      <button
                        onClick={() => onOpenDelete(p)}
                        title={`Delete ${name}`}
                        style={{
                          padding: "5px 9px",
                          border: "1px solid #fecaca",
                          background: "#fff1f2",
                          color: "#dc2626",
                          borderRadius: 6,
                          cursor: "pointer",
                          fontSize: 12,
                        }}
                      >
                        🗑
                      </button>
                    )}
                  </div>
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
