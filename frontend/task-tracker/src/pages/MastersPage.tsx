import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { MasterItem, MasterModalState, Profile } from "@/types";
import { useMasters, type MasterKind } from "@/hooks/useMasters";
import { useOrgs } from "@/hooks/useOrgs";
import { saveLS } from "@/utils/storage";
import { OrgBadges } from "@/components/masters/OrgBadges";
import { SWATCH, delBtn, secBtn } from "@/utils/masters";

interface MastersPageProps {
  profile: Profile | null;
}

type TabId = "orgs" | "clients" | "cats" | "team";

const TAB_TO_KIND: Readonly<Record<Exclude<TabId, "orgs">, MasterKind>> = {
  clients: "client",
  cats: "category",
  team: "team",
};

const sortByName = <T extends { name: string }>(arr: T[]): T[] =>
  [...arr].sort((a, b) => a.name.localeCompare(b.name));

export default function MastersPage({ profile }: MastersPageProps) {
  const isAdmin = profile?.role === "admin";
  const [tab, setTab] = useState<TabId>(isAdmin ? "orgs" : "clients");
  const [modal, setModal] = useState<MasterModalState | null>(null);
  const [formName, setFormName] = useState("");
  const [formColor, setFormColor] = useState<string>(SWATCH[0]);
  const [formOrgUid, setFormOrgUid] = useState<string>("");
  const [toast, setToast] = useState("");

  const {
    clients,
    cats,
    team,
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

  // Keep the localStorage cache up to date so legacy helpers
  // (getLiveClients, getLiveOrgs, etc.) see server-authoritative data.
  const orgNameByUid = useMemo(() => {
    const map: Record<string, string> = {};
    orgs.forEach((o) => {
      map[o.id] = o.name;
    });
    return map;
  }, [orgs]);

  useEffect(() => {
    if (loading) return;
    saveLS(
      "tt_orgs",
      orgs.map((o) => ({ id: o.id, name: o.name })),
    );
    const mapRow = (m: MasterItem) => ({
      id: m.id,
      name: m.name,
      color: m.color ?? null,
      org: m.org ? (orgNameByUid[m.org] ?? null) : null,
    });
    saveLS("tt_clients", clients.map(mapRow));
    saveLS("tt_cats", cats.map(mapRow));
    saveLS("tt_team", team.map(mapRow));
  }, [loading, orgs, clients, cats, team, orgNameByUid]);

  const showToast = (msg: string): void => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  const openAdd = (): void => {
    setFormName("");
    setFormColor(SWATCH[0]);
    setFormOrgUid("");
    setModal({ type: tab, item: null });
  };
  const openEdit = (item: MasterItem): void => {
    setFormName(item.name);
    setFormColor(item.color || SWATCH[0]);
    setFormOrgUid(item.org ?? "");
    setModal({ type: tab, item });
  };
  const closeModal = (): void => setModal(null);

  const handleSave = async (): Promise<void> => {
    if (!modal) return;
    const currentTab = modal.type as TabId;
    let ok = false;
    if (currentTab === "orgs") {
      ok = await saveOrg(modal.item, formName);
    } else {
      const kind = TAB_TO_KIND[currentTab];
      const color = kind === "team" ? formColor : null;
      const orgUid = kind === "category" ? null : formOrgUid || null;
      ok = await saveItem(kind, modal.item, formName, color, orgUid);
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
    else await deleteItem(id);
    showToast("🗑️ Deleted");
  };

  const allTabs = [
    { id: "orgs" as const, label: "🏢 Organizations", items: sortByName(orgs) },
    { id: "clients" as const, label: "🏢 Clients", items: sortByName(clients) },
    { id: "cats" as const, label: "🏷️ Categories", items: sortByName(cats) },
    { id: "team" as const, label: "👤 Team Members", items: sortByName(team) },
  ];
  const tabs = isAdmin
    ? allTabs
    : allTabs.filter((t) => t.id === "clients" || t.id === "orgs");
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
            <span style={{ fontSize: 11, color: "#94a3b8" }}>
              ({t.items.length})
            </span>
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
              {(tab !== "orgs" || isAdmin) && (
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
                <strong>Step 2:</strong> Go to <strong>Clients</strong> and{" "}
                <strong>Team Members</strong> tabs to assign each one to an
                organization.
              </div>
            )}

            {currentTab.items.length === 0 && (
              <p style={{ color: "#94a3b8", fontSize: 13 }}>
                No items yet. Click + Add.
              </p>
            )}

            <div
              style={{
                display: tab === "team" ? "block" : "grid",
                gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))",
                gap: 6,
              }}
            >
              {currentTab.items.map((item) => (
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
                    marginBottom: tab === "team" ? 6 : 0,
                  }}
                >
                  {tab === "team" ? (
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: "50%",
                        background: item.color || "#64748b",
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 11,
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {item.name.slice(0, 2).toUpperCase()}
                    </div>
                  ) : tab === "orgs" ? (
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
                  <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>
                    {item.name}
                  </span>
                  {(tab === "clients" || tab === "team") && item.org && (
                    <OrgBadges org={orgNameByUid[item.org] ?? null} />
                  )}
                  {(tab !== "orgs" || isAdmin) && (
                    <>
                      <button onClick={() => openEdit(item)} style={secBtn}>
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

      {/* Modal */}
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
            {(tab === "clients" || tab === "team") && orgs.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <label
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#475569",
                    display: "block",
                    marginBottom: 8,
                  }}
                >
                  Organization
                </label>
                <select
                  value={formOrgUid}
                  onChange={(e) => setFormOrgUid(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    border: "2px solid #e2e8f0",
                    borderRadius: 6,
                    fontSize: 13,
                    boxSizing: "border-box",
                  }}
                >
                  <option value="">— None —</option>
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      🏢 {o.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {tab === "team" && (
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
                  Colour
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {SWATCH.map((c) => (
                    <div
                      key={c}
                      onClick={() => setFormColor(c)}
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: "50%",
                        background: c,
                        cursor: "pointer",
                        border:
                          formColor === c
                            ? "3px solid #1e293b"
                            : "2px solid transparent",
                        boxSizing: "border-box",
                      }}
                    />
                  ))}
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
    </div>
  );
}
