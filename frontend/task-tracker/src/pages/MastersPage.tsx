import { useMemo, useState, type CSSProperties } from "react";
import type { MasterItem, MasterModalState, Profile } from "@/types";
import type { MasterRecurrence } from "@/types/api";
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
  // Sub-category template recurrence + target day. Only used when the
  // category has a parent — the occurrence engine in TaskModal reads
  // these to materialise one subtask row per occurrence.
  const [formRecurrence, setFormRecurrence] = useState<MasterRecurrence>("");
  const [formTargetDay, setFormTargetDay] = useState<string>("");
  // Inline children editor — only used when the dialog is for a MAIN
  // category (parent is empty). Each row carries a real master uid for
  // existing children (so we can update or delete) or ``null`` for ones
  // the user just typed in. ``saveMainWithChildren`` orchestrates create
  // / update / delete in one click.
  type ChildRow = {
    id: string | null;
    name: string;
    recurrence: MasterRecurrence;
    targetDay: string;
  };
  const [formChildren, setFormChildren] = useState<ChildRow[]>([]);
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
    toggleActive,
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

  // Count subs per main category — drives the green dot + count badge
  // so users can tell at a glance which mains have children configured.
  const subCountByParent = useMemo(() => {
    const map: Record<string, number> = {};
    cats.forEach((c) => {
      if (c.parent) map[c.parent] = (map[c.parent] ?? 0) + 1;
    });
    return map;
  }, [cats]);

  // Active clients sort first, then inactives. Names alphabetical within each
  // group so the grid keeps stable order after a toggle.
  const sortedClients = useMemo(() => {
    const active = clients.filter((c) => c.is_active !== false);
    const inactive = clients.filter((c) => c.is_active === false);
    return [...sortByName(active), ...sortByName(inactive)];
  }, [clients]);

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
    setFormRecurrence("");
    setFormTargetDay("");
    setFormChildren([]);
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
    setFormRecurrence(item.recurrence ?? "");
    setFormTargetDay(
      item.target_day != null ? String(item.target_day) : "",
    );
    // For main categories on the cats tab, hydrate the inline children
    // editor with everything currently parented to this row. Sub rows
    // are still editable standalone, but the recommended path is to
    // open the parent and edit them all at once.
    if (tab === "cats" && !item.parent) {
      const kids = cats
        .filter((c) => c.parent === item.id)
        .map<ChildRow>((c) => ({
          id: c.id,
          name: c.name,
          recurrence: (c.recurrence ?? "") as MasterRecurrence,
          targetDay: c.target_day != null ? String(c.target_day) : "",
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setFormChildren(kids);
    } else {
      setFormChildren([]);
    }
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

  // Parse a child row's recurrence + target day, returning the validated
  // backend payload pair or ``null`` if the user picked a recurrence
  // without a valid day. Weekly reuses target_day as ISO weekday (1=Mon
  // ... 7=Sun); other recurrences treat it as day-of-month (1-31).
  const parseRecurrence = (
    recurrence: MasterRecurrence,
    rawDay: string,
  ): { ok: true; rec: MasterRecurrence; day: number | null } | { ok: false } => {
    if (!recurrence) return { ok: true, rec: "", day: null };
    const parsed = rawDay.trim() ? Number(rawDay) : NaN;
    const max = recurrence === "Weekly" ? 7 : 31;
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > max) {
      return { ok: false };
    }
    return { ok: true, rec: recurrence, day: parsed };
  };

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
      // Recurrence + target day on the *standalone* sub-cat path. The
      // inline children editor (main-cat dialog) handles its own rows
      // below.
      const standaloneRec = parseRecurrence(formRecurrence, formTargetDay);
      if (parentForSave && !standaloneRec.ok) {
        alert(
          formRecurrence === "Weekly"
            ? "Enter a Target Weekday between 1 (Mon) and 7 (Sun)."
            : "Enter a Target Day between 1 and 31.",
        );
        return;
      }
      const recForSave: MasterRecurrence =
        parentForSave && standaloneRec.ok ? standaloneRec.rec : "";
      const dayForSave: number | null =
        parentForSave && standaloneRec.ok ? standaloneRec.day : null;

      // Validate every inline child before any network call so we can
      // bail early without leaving the parent saved + half the kids
      // missing. Empty-name rows are trimmed silently — they're
      // placeholder rows the user added but didn't fill in.
      const childRowsToSave = formChildren.filter((c) => c.name.trim());
      // Reject duplicate names within the grid. The backend enforces the
      // same uniqueness via ``master_unique_sub`` (type, name, org, parent)
      // and would otherwise return a 400 mid-loop, leaving the user with
      // an opaque alert and a partially-applied save.
      const seenChildNames = new Map<string, number>();
      for (const child of childRowsToSave) {
        const key = child.name.trim().toLowerCase();
        const prev = seenChildNames.get(key);
        if (prev != null) {
          alert(
            `Duplicate subcategory name "${child.name.trim()}". Each subcategory under a main category must have a unique name.`,
          );
          return;
        }
        seenChildNames.set(key, 1);
      }
      for (const child of childRowsToSave) {
        const parsed = parseRecurrence(child.recurrence, child.targetDay);
        if (!parsed.ok) {
          alert(
            child.recurrence === "Weekly"
              ? `"${child.name}" needs a Target Weekday between 1 (Mon) and 7 (Sun).`
              : `"${child.name}" needs a Target Day between 1 and 31 for its recurrence.`,
          );
          return;
        }
      }

      const savedMain = await saveItem(
        kind,
        modal.item,
        formName,
        null,
        orgUids,
        parentForSave,
        recForSave,
        dayForSave,
      );
      ok = !!savedMain;

      // Only main categories carry inline children. ``parentForSave``
      // being non-null means this row itself is a sub-cat — the
      // children panel was hidden in that case so we don't touch it.
      if (
        ok &&
        savedMain &&
        kind === "category" &&
        !parentForSave
      ) {
        // Capture the children that lived under this main *before* the
        // dialog opened so we can compute deletions. ``formChildren``
        // is the desired final state.
        const originalChildIds = new Set(
          cats
            .filter((c) => c.parent === savedMain.id)
            .map((c) => c.id),
        );
        const keptIds = new Set(
          formChildren.map((c) => c.id).filter((id): id is string => !!id),
        );

        // Inherit the parent's org membership for new kids so they
        // show up in the same org dropdowns. Existing kids keep their
        // own org list.
        const parentOrgs = savedMain.orgs.length
          ? savedMain.orgs
          : savedMain.org
            ? [savedMain.org]
            : orgs.map((o) => o.id);

        for (const child of childRowsToSave) {
          const parsed = parseRecurrence(child.recurrence, child.targetDay);
          if (!parsed.ok) continue; // pre-validated above
          const existing = child.id
            ? cats.find((c) => c.id === child.id) ?? null
            : null;
          const childOrgs = existing?.orgs?.length
            ? existing.orgs
            : parentOrgs;
          const saved = await saveItem(
            "category",
            existing,
            child.name,
            null,
            childOrgs,
            savedMain.id,
            parsed.rec,
            parsed.day,
          );
          if (!saved) {
            ok = false;
            break;
          }
        }

        // Anything that was a child before the dialog opened but no
        // longer appears in ``formChildren`` (or was renamed-via-
        // delete) is a removal. ``skipConfirm`` because the user
        // already confirmed by hitting Save.
        if (ok) {
          for (const oldId of originalChildIds) {
            if (!keptIds.has(oldId)) {
              await deleteItem(oldId, { skipConfirm: true });
            }
          }
        }
      }
    }
    if (ok) {
      closeModal();
      showToast("✅ Saved to server!");
    }
  };

  const handleToggleActive = async (item: MasterItem): Promise<void> => {
    if (item.is_active !== false) {
      const ok = window.confirm(
        `Deactivate "${item.name}"? Existing entries are kept untouched. The client will no longer appear in new-entry dropdowns.`,
      );
      if (!ok) return;
    }
    const res = await toggleActive(item);
    if (res) {
      showToast(
        res.is_active ? `✅ ${res.name} reactivated` : `🚫 ${res.name} deactivated`,
      );
    }
  };

  const activePillBtn: CSSProperties = {
    padding: "2px 8px",
    fontSize: 11,
    fontWeight: 600,
    background: "#d1fae5",
    color: "#065f46",
    border: "none",
    borderRadius: 4,
    cursor: "pointer",
  };
  const inactivePillBtn: CSSProperties = {
    ...activePillBtn,
    background: "#e5e7eb",
    color: "#4b5563",
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
    {
      id: "cats" as const,
      label: "🏷️ Categories",
      // Subcategories are managed inline inside their main-cat dialog —
      // surface only the mains in the grid (and the tab count) so the
      // master view stays a clean list of top-level categories.
      count: cats.filter((c) => !c.parent).length,
    },
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
                      ? sortedClients
                      : // Mains only — subs are edited inline in the main
                        // category's dialog, so showing them as separate
                        // cards here would just duplicate the listing.
                        sortByName(cats.filter((c) => !c.parent))
                  ).map((item) => {
                    const isInactiveClientCard =
                      tab === "clients" &&
                      "is_active" in item &&
                      (item as MasterItem).is_active === false;
                    return (
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
                          background: isInactiveClientCard ? "#f1f5f9" : "#fafafa",
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
                            background:
                              tab === "cats" &&
                              !(item as MasterItem).parent &&
                              (subCountByParent[item.id] ?? 0) > 0
                                ? "#10b981"
                                : "#2563eb",
                            flexShrink: 0,
                            opacity: isInactiveClientCard ? 0.4 : 1,
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
                          color: isInactiveClientCard ? "#94a3b8" : undefined,
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
                        {tab === "cats" &&
                          !(item as MasterItem).parent &&
                          (subCountByParent[item.id] ?? 0) > 0 && (
                            <span
                              title={`${subCountByParent[item.id]} sub-categor${subCountByParent[item.id] === 1 ? "y" : "ies"}`}
                              style={{
                                marginLeft: 8,
                                fontSize: 10,
                                fontWeight: 600,
                                background: "#d1fae5",
                                color: "#065f46",
                                padding: "1px 6px",
                                borderRadius: 4,
                                letterSpacing: 0.2,
                              }}
                            >
                              {subCountByParent[item.id]} sub
                            </span>
                          )}
                        {tab === "cats" &&
                          (item as MasterItem).recurrence && (
                            <span
                              style={{
                                marginLeft: 6,
                                fontSize: 10,
                                fontWeight: 600,
                                background: "#fef3c7",
                                color: "#92400e",
                                padding: "1px 6px",
                                borderRadius: 4,
                                letterSpacing: 0.2,
                              }}
                            >
                              {(item as MasterItem).recurrence}
                              {(item as MasterItem).target_day != null
                                ? ` · ${(item as MasterItem).target_day}`
                                : ""}
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
                      {tab === "clients" && (
                        <button
                          aria-label={
                            isInactiveClientCard ? "Inactive" : "Active"
                          }
                          title={
                            isInactiveClientCard
                              ? "Inactive — click to reactivate"
                              : "Active — click to deactivate"
                          }
                          onClick={() =>
                            handleToggleActive(item as MasterItem)
                          }
                          style={
                            isInactiveClientCard
                              ? inactivePillBtn
                              : activePillBtn
                          }
                        >
                          {isInactiveClientCard ? "Inactive" : "Active"}
                        </button>
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
                    );
                  })}
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
              // Cats need extra width when the inline children grid is
              // visible — three input columns + a delete button stack
              // tightly at 440px. Other tabs keep the compact width.
              maxWidth: tab === "cats" && !formParent ? 720 : 440,
              maxHeight: "90vh",
              overflowY: "auto",
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
            {tab === "cats" && !formParent && (
              <div style={{ marginBottom: 14 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 8,
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: "#475569",
                      letterSpacing: 0.3,
                    }}
                  >
                    SUBCATEGORIES ({formChildren.length})
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setFormChildren((prev) => [
                        ...prev,
                        {
                          id: null,
                          name: "",
                          recurrence: "",
                          targetDay: "",
                        },
                      ])
                    }
                    style={secBtn}
                  >
                    + Add subcategory
                  </button>
                </div>
                {formChildren.length === 0 && (
                  <div
                    style={{
                      padding: "12px 14px",
                      border: "1px dashed #cbd5e1",
                      borderRadius: 6,
                      color: "#94a3b8",
                      fontSize: 12,
                      lineHeight: 1.45,
                    }}
                  >
                    No subcategories yet. Click <strong>+ Add subcategory</strong> to
                    define the rows that auto-fill in Add Task when a user
                    picks this main category.
                  </div>
                )}
                {formChildren.length > 0 && (
                  <div
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: 6,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "2fr 1.3fr 1fr 32px",
                        gap: 6,
                        padding: "6px 10px",
                        background: "#f1f5f9",
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#475569",
                        letterSpacing: 0.3,
                        textTransform: "uppercase",
                      }}
                    >
                      <span>Name</span>
                      <span>Recurrence</span>
                      <span>Target day</span>
                      <span></span>
                    </div>
                    {formChildren.map((child, idx) => (
                      <div
                        key={child.id ?? `new-${idx}`}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "2fr 1.3fr 1fr 32px",
                          gap: 6,
                          padding: "6px 10px",
                          borderTop:
                            idx === 0 ? "none" : "1px solid #f1f5f9",
                          alignItems: "center",
                        }}
                      >
                        <input
                          value={child.name}
                          placeholder="e.g. Book Keeping"
                          onChange={(e) =>
                            setFormChildren((prev) =>
                              prev.map((r, i) =>
                                i === idx
                                  ? { ...r, name: e.target.value }
                                  : r,
                              ),
                            )
                          }
                          style={{
                            padding: "6px 8px",
                            border: "1px solid #e2e8f0",
                            borderRadius: 4,
                            fontSize: 12,
                          }}
                        />
                        <select
                          value={child.recurrence}
                          onChange={(e) =>
                            setFormChildren((prev) =>
                              prev.map((r, i) =>
                                i === idx
                                  ? {
                                      ...r,
                                      recurrence: e.target
                                        .value as MasterRecurrence,
                                    }
                                  : r,
                              ),
                            )
                          }
                          style={{
                            padding: "6px 8px",
                            border: "1px solid #e2e8f0",
                            borderRadius: 4,
                            fontSize: 12,
                            background: "#fff",
                          }}
                        >
                          <option value="">— None —</option>
                          <option value="Onetime">One-time</option>
                          <option value="Weekly">Weekly</option>
                          <option value="Monthly">Monthly</option>
                          <option value="Quarterly">Quarterly</option>
                          <option value="Halfyearly">Half-yearly</option>
                          <option value="Yearly">Yearly</option>
                        </select>
                        <input
                          type="number"
                          min={1}
                          max={child.recurrence === "Weekly" ? 7 : 31}
                          value={child.targetDay}
                          placeholder={child.recurrence === "Weekly" ? "1–7 (Mon–Sun)" : "1–31"}
                          disabled={!child.recurrence}
                          onChange={(e) =>
                            setFormChildren((prev) =>
                              prev.map((r, i) =>
                                i === idx
                                  ? { ...r, targetDay: e.target.value }
                                  : r,
                              ),
                            )
                          }
                          style={{
                            padding: "6px 8px",
                            border: "1px solid #e2e8f0",
                            borderRadius: 4,
                            fontSize: 12,
                            background: child.recurrence ? "#fff" : "#f8fafc",
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            // For an unsaved row, just drop it. For a
                            // saved one, mark it for deletion by removing
                            // it from formChildren — handleSave reads the
                            // diff against ``cats`` to issue the delete.
                            if (
                              child.id &&
                              !window.confirm(
                                `Remove "${child.name}"? It will be deleted on save.`,
                              )
                            ) {
                              return;
                            }
                            setFormChildren((prev) =>
                              prev.filter((_, i) => i !== idx),
                            );
                          }}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "#dc2626",
                            cursor: "pointer",
                            fontSize: 14,
                            padding: 0,
                          }}
                          aria-label="Remove subcategory"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div
                  style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}
                >
                  Subcategories with a recurrence + target day materialise
                  multiple subtask rows in Add Task (e.g. monthly on the
                  15th = 12 rows, weekly on Mon ≈ 52 rows in a 12-month
                  engagement).
                </div>
              </div>
            )}
            {tab === "cats" && formParent && (
              <div
                style={{
                  marginBottom: 14,
                  padding: 12,
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: 6,
                  display: "grid",
                  gridTemplateColumns: "2fr 1fr",
                  gap: 10,
                }}
              >
                <div>
                  <label
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: "#475569",
                      display: "block",
                      marginBottom: 4,
                    }}
                  >
                    Recurrence
                  </label>
                  <select
                    value={formRecurrence}
                    onChange={(e) =>
                      setFormRecurrence(e.target.value as MasterRecurrence)
                    }
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
                    <option value="">— None (single subtask) —</option>
                    <option value="Onetime">One-time</option>
                    <option value="Weekly">Weekly</option>
                    <option value="Monthly">Monthly</option>
                    <option value="Quarterly">Quarterly</option>
                    <option value="Halfyearly">Half-yearly</option>
                    <option value="Yearly">Yearly</option>
                  </select>
                </div>
                <div>
                  <label
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: "#475569",
                      display: "block",
                      marginBottom: 4,
                    }}
                  >
                    {formRecurrence === "Weekly"
                      ? "Target weekday (1–7, Mon–Sun)"
                      : "Target day (1–31)"}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={formRecurrence === "Weekly" ? 7 : 31}
                    value={formTargetDay}
                    onChange={(e) => setFormTargetDay(e.target.value)}
                    placeholder={formRecurrence === "Weekly" ? "e.g. 1 (Mon)" : "e.g. 15"}
                    disabled={!formRecurrence}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      border: "2px solid #e2e8f0",
                      borderRadius: 6,
                      fontSize: 13,
                      boxSizing: "border-box",
                      background: formRecurrence ? "#fff" : "#f1f5f9",
                    }}
                  />
                </div>
                <div
                  style={{
                    gridColumn: "1 / -1",
                    fontSize: 11,
                    color: "#94a3b8",
                    lineHeight: 1.45,
                  }}
                >
                  Pick a recurrence and a target day (e.g. 15 for Monthly, or
                  1 for Weekly = every Monday) to materialise one subtask per
                  occurrence. The day clamps to the last day of short months
                  (e.g. day 31 in Feb becomes 28/29).
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
