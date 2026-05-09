import { useMemo, useState, type CSSProperties } from "react";
import type { MasterItem, MasterModalState, Profile } from "@/types";
import { useMasters, type MasterKind } from "@/hooks/useMasters";
import { useOrgs } from "@/hooks/useOrgs";
import { OrgBadges } from "@/components/masters/OrgBadges";
import { SWATCH, delBtn, secBtn } from "@/utils/masters";
import { apiPatch, ApiError } from "@/lib/api";

import { useAuth } from "@/hooks/useAuth";

interface MastersPageProps {
  profile: Profile | null;
  /** Every profile visible to the caller. Used to render the Team tab —
   *  we no longer keep a parallel ``Master(type='team')`` table. */
  profiles: Profile[];
  /** Header-level org filter (uid). Empty = show all orgs. */
  selectedOrg?: string;
  /** Triggers a ``/users/`` re-fetch after we patch avatar_color so the
   *  change propagates everywhere else it's displayed. */
  onRefreshProfiles?: () => void | Promise<void>;
}

type TabId = "orgs" | "clients" | "cats" | "team";

const TAB_TO_KIND: Readonly<Record<"clients" | "cats", MasterKind>> = {
  clients: "client",
  cats: "category",
};

const sortByName = <T extends { name: string }>(arr: T[]): T[] =>
  [...arr].sort((a, b) => a.name.localeCompare(b.name));

export default function MastersPage({
  profile: _profile,
  profiles,
  selectedOrg = "",
  onRefreshProfiles,
}: MastersPageProps) {
  const { isAdminInAny } = useAuth();
  const isAdmin = isAdminInAny();
  const [tab, setTab] = useState<TabId>(isAdmin ? "orgs" : "clients");
  const [modal, setModal] = useState<MasterModalState | null>(null);
  const [formName, setFormName] = useState("");
  // Multi-org selection. A client or category can be shared across any
  // number of orgs; the modal surfaces a checkbox list, ``handleSave``
  // sends the list to the backend's new ``orgs`` M2M field.
  const [formOrgUids, setFormOrgUids] = useState<string[]>([]);
  // Parent category selection (categories tab only). Empty string =
  // top-level / "main" category; otherwise it's the parent master uid.
  const [formParent, setFormParent] = useState<string>("");
  const [toast, setToast] = useState("");

  // Team-tab modal state. Kept separate from the Master modal because the
  // payload shape is different (User + avatar_color, not Master + org).
  const [teamEdit, setTeamEdit] = useState<Profile | null>(null);
  const [teamColor, setTeamColor] = useState<string>(SWATCH[0]);
  const [teamSaving, setTeamSaving] = useState(false);

  const {
    clients,
    cats,
    loading: mastersLoading,
    saving: mastersSaving,
    saveItem,
    deleteItem,
  } = useMasters();
  const {
    orgs,
    loading: orgsLoading,
    saving: orgsSaving,
    saveOrg,
    deleteOrg,
  } = useOrgs();

  const loading = mastersLoading || orgsLoading;
  const saving = mastersSaving || orgsSaving;

  // Team tab = Users scoped to the selected org (or every visible user
  // when "All Orgs" is active). Sorted by name so the grid stays stable.
  const teamMembers = useMemo(() => {
    const list = selectedOrg
      ? profiles.filter((p) => p.orgs.some((o) => o.uid === selectedOrg))
      : profiles;
    return [...list]
      .filter((p) => p.full_name)
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [profiles, selectedOrg]);

  const orgNameByUid = useMemo(() => {
    const map: Record<string, string> = {};
    orgs.forEach((o) => {
      map[o.id] = o.name;
    });
    return map;
  }, [orgs]);

  const showToast = (msg: string): void => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  const openAdd = (): void => {
    setFormName("");
    // Pre-tick the header-selected org (if any) so the common "add client
    // in this org" flow is one click. Multi-org users can tick additional
    // boxes in the modal before saving.
    setFormOrgUids(selectedOrg ? [selectedOrg] : []);
    setFormParent("");
    setModal({ type: tab, item: null });
  };
  const openEdit = (item: MasterItem): void => {
    setFormName(item.name);
    // Prefer the M2M; fall back to the legacy single-org FK so rows
    // from pre-migration still open with the right selection.
    const preselect =
      item.orgs && item.orgs.length > 0
        ? item.orgs
        : item.org
          ? [item.org]
          : [];
    setFormOrgUids([...preselect]);
    setFormParent(item.parent ?? "");
    setModal({ type: tab, item });
  };
  const closeModal = (): void => setModal(null);

  // ── Team tab actions ────────────────────────────────────────────────────

  const openTeamEdit = (p: Profile): void => {
    setTeamEdit(p);
    setTeamColor(p.avatar_color || SWATCH[0]);
  };
  const closeTeamEdit = (): void => setTeamEdit(null);

  const saveTeamEdit = async (): Promise<void> => {
    if (!teamEdit) return;
    setTeamSaving(true);
    try {
      await apiPatch(`/users/${teamEdit.id}/avatar_color/`, {
        avatar_color: teamColor,
      });
      await onRefreshProfiles?.();
      closeTeamEdit();
      showToast("✅ Saved to server!");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Save failed: ${msg}`);
    } finally {
      setTeamSaving(false);
    }
  };

  // ── Master CRUD ─────────────────────────────────────────────────────────

  const handleSave = async (): Promise<void> => {
    if (!modal) return;
    const currentTab = modal.type as TabId;
    if (currentTab === "team") return; // team uses its own modal
    let ok = false;
    if (currentTab === "orgs") {
      ok = await saveOrg(modal.item, formName);
    } else {
      const kind = TAB_TO_KIND[currentTab];
      // Categories never get an org picker — they're "global per-caller".
      // On create, attach to the header-filtered org if one is set, else
      // every org the caller belongs to. Sending an empty list makes
      // resolve_create_org 400 for users in 2+ orgs ("`org` is required").
      // On edit, reuse formOrgUids (pre-loaded from the row) so we don't
      // silently expand or wipe its scope.
      let orgUids: readonly string[];
      if (kind === "category" && !modal.item) {
        orgUids = selectedOrg ? [selectedOrg] : orgs.map((o) => o.id);
      } else {
        orgUids = formOrgUids;
      }
      // Parent only travels with categories — clients ignore the field.
      const parentForSave =
        kind === "category" && formParent ? formParent : null;
      ok = await saveItem(
        kind,
        modal.item,
        formName,
        null,
        orgUids,
        parentForSave,
      );
    }
    if (ok) {
      closeModal();
      showToast("✅ Saved to server!");
    }
  };

  const handleDelete = async (
    currentTab: TabId,
    id: string,
  ): Promise<void> => {
    if (currentTab === "orgs") await deleteOrg(id);
    else if (currentTab !== "team") await deleteItem(id);
    showToast("🗑️ Deleted");
  };

  const allTabs = [
    { id: "orgs" as const, label: "🏢 Organizations", count: orgs.length },
    { id: "clients" as const, label: "🏢 Clients", count: clients.length },
    { id: "cats" as const, label: "🏷️ Categories", count: cats.length },
    { id: "team" as const, label: "👤 Team Members", count: teamMembers.length },
  ];
  // Orgs tab is admin-only. Everyone with Masters access sees the other
  // three. Team is read-mostly (colour edit is the only write we expose).
  const tabs = isAdmin
    ? allTabs
    : allTabs.filter((t) => t.id !== "orgs");
  const currentTab = tabs.find((t) => t.id === tab) ?? tabs[0];
  const boxStyle: CSSProperties = {
    background: "#fff",
    borderRadius: 10,
    padding: 16,
    boxShadow: "0 1px 4px rgba(0,0,0,.08)",
  };

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
        <div className="page-title">⚙️ Masters</div>
      </div>

      {/* Sub-tabs */}
      <div
        className="wl-subtab-bar"
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 14,
          background: "#f1f5f9",
          padding: 4,
          borderRadius: 8,
          width: "fit-content",
          flexWrap: "wrap",
        }}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "6px 16px",
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              background: tab === t.id ? "#fff" : "transparent",
              color: tab === t.id ? "#1e293b" : "#64748b",
              boxShadow: tab === t.id ? "0 1px 3px rgba(0,0,0,.1)" : "none",
            }}
          >
            {t.label}{" "}
            <span style={{ fontSize: 11, color: "#94a3b8" }}>({t.count})</span>
          </button>
        ))}
      </div>

      <div className="dm-box" style={boxStyle}>
        {loading ? (
          <div style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>
            Loading…
          </div>
        ) : (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 14,
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 15 }}>
                {currentTab.label}
              </span>
              {tab !== "team" && (tab !== "orgs" || isAdmin) && (
                <button
                  onClick={openAdd}
                  style={{
                    padding: "6px 14px",
                    background: "#2563eb",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontWeight: 600,
                    fontSize: 13,
                  }}
                >
                  + Add
                </button>
              )}
            </div>

            {tab === "orgs" && isAdmin && (
              <div
                style={{
                  background: "#eff6ff",
                  border: "1px solid #bfdbfe",
                  borderRadius: 8,
                  padding: "10px 14px",
                  marginBottom: 12,
                  fontSize: 12,
                  color: "#1d4ed8",
                  lineHeight: 1.5,
                }}
              >
                ℹ️ <strong>Step 1:</strong> Add your organizations here (e.g.{" "}
                <em>YBV</em>, <em>4D</em>).
                <br />
                <strong>Step 2:</strong> Go to the <strong>Clients</strong> tab
                to assign each one to an organization. Team members are
                managed on the Users page; their avatar colour is editable
                from the Team Members tab here.
              </div>
            )}

            {tab === "team" && (
              <div
                style={{
                  background: "#f0fdf4",
                  border: "1px solid #bbf7d0",
                  borderRadius: 8,
                  padding: "10px 14px",
                  marginBottom: 12,
                  fontSize: 12,
                  color: "#166534",
                  lineHeight: 1.5,
                }}
              >
                ℹ️ Team members live on the Users page. This tab shows the
                same people (scoped to the selected org) so you can tweak
                their avatar colour without admin access.
              </div>
            )}

            {/* Orgs / Clients / Categories — Master-backed grid */}
            {tab !== "team" && (
              <>
                {currentTab.count === 0 && (
                  <p style={{ color: "#94a3b8", fontSize: 13 }}>
                    No items yet. Click + Add.
                  </p>
                )}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))",
                    gap: 6,
                  }}
                >
                  {(tab === "orgs"
                    ? sortByName(orgs)
                    : tab === "clients"
                      ? sortByName(clients)
                      : // Group cats by parent: mains first (alphabetical),
                        // then their children clustered underneath. Keeps the
                        // grid readable as the parent/child set grows.
                        (() => {
                          const byId = new Map(
                            cats.map((c) => [c.id, c.name]),
                          );
                          const mains = sortByName(cats.filter((c) => !c.parent));
                          const orphanSubs = sortByName(
                            cats.filter(
                              (c) => c.parent && !byId.has(c.parent),
                            ),
                          );
                          const out: MasterItem[] = [];
                          for (const m of mains) {
                            out.push(m);
                            const subs = sortByName(
                              cats.filter((c) => c.parent === m.id),
                            );
                            out.push(...subs);
                          }
                          out.push(...orphanSubs);
                          return out;
                        })()
                  ).map((item) => (
                    <div
                      key={item.id}
                      className="dm-item-card"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "9px 12px",
                        borderRadius: 7,
                        border: "1px solid #f1f5f9",
                        background: "#fafafa",
                      }}
                    >
                      {tab === "orgs" ? (
                        <div
                          style={{
                            width: 30,
                            height: 30,
                            borderRadius: 8,
                            background: "#2563eb",
                            color: "#fff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 14,
                            flexShrink: 0,
                          }}
                        >
                          🏢
                        </div>
                      ) : (
                        <div
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            background: "#2563eb",
                            flexShrink: 0,
                          }}
                        />
                      )}
                      <span
                        style={{
                          flex: 1,
                          fontWeight: 600,
                          fontSize: 13,
                          paddingLeft:
                            tab === "cats" &&
                            "parent" in item &&
                            (item as MasterItem).parent
                              ? 18
                              : 0,
                        }}
                      >
                        {tab === "cats" &&
                        "parent" in item &&
                        (item as MasterItem).parent ? (
                          <span style={{ color: "#94a3b8", marginRight: 4 }}>
                            ↳
                          </span>
                        ) : null}
                        {item.name}
                        {tab === "cats" &&
                          "parent" in item &&
                          (item as MasterItem).parent && (
                            <span
                              style={{
                                marginLeft: 8,
                                fontSize: 10,
                                fontWeight: 600,
                                background: "#e0e7ff",
                                color: "#4338ca",
                                padding: "1px 6px",
                                borderRadius: 4,
                                textTransform: "uppercase",
                                letterSpacing: 0.3,
                              }}
                            >
                              sub
                            </span>
                          )}
                      </span>
                      {tab === "clients" &&
                        "orgs" in item &&
                        ((item as MasterItem).orgs?.length ?? 0) > 0 && (
                          <OrgBadges
                            org={(item as MasterItem).orgs
                              .map((u) => orgNameByUid[u] || "")
                              .filter(Boolean)}
                          />
                        )}
                      {(tab !== "orgs" || isAdmin) && (
                        <>
                          <button
                            onClick={() => openEdit(item as MasterItem)}
                            style={secBtn}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(tab, item.id)}
                            style={delBtn}
                          >
                            Del
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Team Members — User-backed, colour-only edit */}
            {tab === "team" && (
              <>
                {teamMembers.length === 0 && (
                  <p style={{ color: "#94a3b8", fontSize: 13 }}>
                    No members in this view.
                  </p>
                )}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))",
                    gap: 6,
                  }}
                >
                  {teamMembers.map((p) => {
                    const color = p.avatar_color || "#64748b";
                    const initials = p.full_name
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((w) => w[0]?.toUpperCase() ?? "")
                      .join("");
                    const orgNames = p.orgs
                      .map((o) => o.name)
                      .filter(Boolean)
                      .join(", ");
                    return (
                      <div
                        key={p.id}
                        className="dm-item-card"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "9px 12px",
                          borderRadius: 7,
                          border: "1px solid #f1f5f9",
                          background: "#fafafa",
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
                            fontSize: 11,
                            fontWeight: 700,
                            flexShrink: 0,
                          }}
                        >
                          {initials || "?"}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontWeight: 600,
                              fontSize: 13,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {p.full_name}
                          </div>
                          {orgNames && (
                            <div
                              style={{
                                fontSize: 11,
                                color: "#64748b",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {orgNames}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => openTeamEdit(p)}
                          style={secBtn}
                          title="Change avatar colour"
                        >
                          Colour
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#1e293b",
            color: "#fff",
            padding: "10px 20px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            zIndex: 9999,
            pointerEvents: "none",
            boxShadow: "0 4px 12px rgba(0,0,0,.3)",
          }}
        >
          {toast}
        </div>
      )}

      {/* Master-CRUD modal (orgs / clients / cats) */}
      {modal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={closeModal}
        >
          <div
            className="dm-modal-card"
            style={{
              background: "#fff",
              borderRadius: 12,
              padding: 24,
              minWidth: 360,
              maxWidth: 440,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 16,
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 16 }}>
                {modal.item ? "Edit" : "Add"} {currentTab.label}
              </span>
              <button
                onClick={closeModal}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: 18,
                  cursor: "pointer",
                  color: "#64748b",
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#475569",
                  display: "block",
                  marginBottom: 4,
                }}
              >
                Name *
              </label>
              <input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Enter name"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSave();
                }}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  border: "2px solid #e2e8f0",
                  borderRadius: 6,
                  fontSize: 13,
                  boxSizing: "border-box",
                }}
              />
            </div>
            {tab === "cats" && (
              <div style={{ marginBottom: 14 }}>
                <label
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#475569",
                    display: "block",
                    marginBottom: 4,
                  }}
                >
                  Parent main category
                </label>
                <select
                  value={formParent}
                  onChange={(e) => setFormParent(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    border: "2px solid #e2e8f0",
                    borderRadius: 6,
                    fontSize: 13,
                    boxSizing: "border-box",
                    background: "#fff",
                  }}
                >
                  <option value="">— None (this is a main category)</option>
                  {sortByName(
                    cats.filter(
                      (c) =>
                        // Only top-level categories can be parents (one level
                        // deep), and a category can't be its own parent.
                        !c.parent && (!modal?.item || c.id !== modal.item.id),
                    ),
                  ).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <div
                  style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}
                >
                  Pick a parent to make this a sub-category. When a user
                  picks the parent in Add Task, this row auto-fills as a
                  subtask.
                </div>
              </div>
            )}
            {tab === "clients" && orgs.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <label
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#475569",
                    display: "block",
                    marginBottom: 6,
                  }}
                >
                  Organizations
                </label>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    padding: "8px 10px",
                    border: "2px solid #e2e8f0",
                    borderRadius: 6,
                    background: "#f8fafc",
                  }}
                >
                  {orgs.map((o) => {
                    const picked = formOrgUids.includes(o.id);
                    return (
                      <label
                        key={o.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          fontSize: 13,
                          cursor: "pointer",
                          padding: "2px 0",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={picked}
                          onChange={(e) =>
                            setFormOrgUids((prev) =>
                              e.target.checked
                                ? [...new Set([...prev, o.id])]
                                : prev.filter((x) => x !== o.id),
                            )
                          }
                          style={{
                            width: 16,
                            height: 16,
                            cursor: "pointer",
                          }}
                        />
                        <span style={{ color: "#1e293b" }}>🏢 {o.name}</span>
                      </label>
                    );
                  })}
                </div>
                <div
                  style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}
                >
                  Tick one or more orgs. The client appears in every ticked
                  org and in every dropdown scoped to those orgs.
                </div>
              </div>
            )}
            <div
              style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}
            >
              <button onClick={closeModal} style={secBtn}>
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  padding: "7px 16px",
                  background: "#2563eb",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: 13,
                  opacity: saving ? 0.7 : 1,
                }}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Team-colour modal */}
      {teamEdit && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={closeTeamEdit}
        >
          <div
            className="dm-modal-card"
            style={{
              background: "#fff",
              borderRadius: 12,
              padding: 24,
              minWidth: 360,
              maxWidth: 440,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 16,
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 16 }}>
                {teamEdit.full_name}
              </span>
              <button
                onClick={closeTeamEdit}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: 18,
                  cursor: "pointer",
                  color: "#64748b",
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#475569",
                  display: "block",
                  marginBottom: 6,
                }}
              >
                Avatar colour
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {SWATCH.map((c) => (
                  <div
                    key={c}
                    onClick={() => setTeamColor(c)}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      background: c,
                      cursor: "pointer",
                      border:
                        teamColor === c
                          ? "3px solid #1e293b"
                          : "2px solid transparent",
                      boxSizing: "border-box",
                    }}
                  />
                ))}
              </div>
              <div
                style={{
                  marginTop: 14,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontSize: 12,
                  color: "#64748b",
                }}
              >
                Preview:
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    background: teamColor,
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {teamEdit.full_name
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((w) => w[0]?.toUpperCase() ?? "")
                    .join("") || "?"}
                </div>
              </div>
            </div>
            <div
              style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}
            >
              <button onClick={closeTeamEdit} style={secBtn}>
                Cancel
              </button>
              <button
                onClick={saveTeamEdit}
                disabled={teamSaving}
                style={{
                  padding: "7px 16px",
                  background: "#2563eb",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: 13,
                  opacity: teamSaving ? 0.7 : 1,
                }}
              >
                {teamSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
