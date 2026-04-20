import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { ApiError, apiDelete, apiGet, ws } from "@/lib/api";
import ClientClassificationModal from "@/components/ClientClassificationModal";
import { useMasters } from "@/hooks/useMasters";
import { useOrgs } from "@/hooks/useOrgs";
import type { Profile, MasterItem } from "@/types";
import type { ClientClassificationDto } from "@/types/api";

interface PaceClientClassPageProps {
  profile: Profile | null;
}

type ClassKey = "A" | "B" | "C" | "D";

const CLASSIFICATIONS: ReadonlyArray<{ value: ClassKey; label: string }> = [
  { value: "A", label: "A - Amazing" },
  { value: "B", label: "B - Breadwinning" },
  { value: "C", label: "C - Convenience" },
  { value: "D", label: "D - Dangerous" },
];

interface ClassConfig {
  color: string;
  bg: string;
  label: string;
  fullLabel: string;
  desc: string;
}

const CLASS_CFG: Record<ClassKey, ClassConfig> = {
  A: {
    color: "#16a34a",
    bg: "#f0fdf4",
    label: "A",
    fullLabel: "A - Amazing",
    desc: "Amazing — Top clients, highest value, strongest relationships",
  },
  B: {
    color: "#2563eb",
    bg: "#eff6ff",
    label: "B",
    fullLabel: "B - Breadwinning",
    desc: "Breadwinning — Reliable revenue, consistent business",
  },
  C: {
    color: "#d97706",
    bg: "#fef3c7",
    label: "C",
    fullLabel: "C - Convenience",
    desc: "Convenience — Low effort, moderate returns",
  },
  D: {
    color: "#dc2626",
    bg: "#fef2f2",
    label: "D",
    fullLabel: "D - Dangerous",
    desc: "Dangerous — High risk, low return, draining resources",
  },
};

const thS: CSSProperties = {
  padding: "8px 12px",
  textAlign: "left",
  fontWeight: 700,
  color: "#475569",
  fontSize: 11,
  borderBottom: "2px solid #e2e8f0",
  whiteSpace: "nowrap",
  background: "#f8fafc",
};
const tdS: CSSProperties = {
  padding: "8px 12px",
  color: "#374151",
  verticalAlign: "middle",
  fontSize: 13,
  borderBottom: "1px solid #f1f5f9",
  whiteSpace: "nowrap",
};
const inpS: CSSProperties = {
  padding: "7px 10px",
  border: "2px solid #e2e8f0",
  borderRadius: 6,
  fontSize: 13,
  width: "100%",
  boxSizing: "border-box",
  background: "#fff",
  fontFamily: "inherit",
};

export default function PaceClientClassPage({
  profile: _profile,
}: PaceClientClassPageProps) {
  void _profile;
  const { clients: allClients } = useMasters();
  const { orgs } = useOrgs();

  const [classifications, setClassifications] = useState<
    ClientClassificationDto[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [fOrg, setFOrg] = useState("");
  const [fClass, setFClass] = useState("");
  const [fSearch, setFSearch] = useState("");
  const [modalMode, setModalMode] = useState<"add" | "edit" | null>(null);
  const [modalExisting, setModalExisting] = useState<
    ClientClassificationDto | undefined
  >();

  const orgNames = useMemo(() => orgs.map((o) => o.name), [orgs]);

  // Selected org's UID — `fOrg` holds the display name from the dropdown.
  // Client/classification membership is stored as UIDs, so we translate here.
  const selectedOrgId = useMemo<string | null>(() => {
    if (!fOrg) return null;
    return orgs.find((o) => o.name === fOrg)?.id ?? null;
  }, [orgs, fOrg]);

  const clientsByUid = useMemo<Map<string, MasterItem>>(() => {
    const m = new Map<string, MasterItem>();
    allClients.forEach((c) => m.set(c.id, c));
    return m;
  }, [allClients]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const rows = await apiGet<ClientClassificationDto[]>(
        "/client_classifications/",
      );
      setClassifications(rows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const unsubscribe = ws.subscribe<ClientClassificationDto>(
      "client-classifications",
      () => {
        void load();
      },
    );
    return unsubscribe;
  }, [load]);

  // Classifications filtered to the selected org. The ClientClassification
  // row itself belongs to exactly one org, so compare `cc.org_uid` directly.
  const orgClassifications = useMemo<ClientClassificationDto[]>(() => {
    if (!selectedOrgId) return classifications;
    return classifications.filter((cc) => cc.org_uid === selectedOrgId);
  }, [classifications, selectedOrgId]);

  const displayRows = useMemo<ClientClassificationDto[]>(() => {
    return orgClassifications
      .filter((cc) => {
        if (fClass === "__none") return !cc.classification;
        if (fClass && cc.classification !== fClass) return false;
        if (fSearch) {
          const q = fSearch.toLowerCase();
          const cli = clientsByUid.get(cc.client);
          const name = cli?.name ?? cc.client_detail?.name ?? "";
          return (
            name.toLowerCase().includes(q) ||
            (cc.notes || "").toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => {
        const an =
          clientsByUid.get(a.client)?.name ?? a.client_detail?.name ?? "";
        const bn =
          clientsByUid.get(b.client)?.name ?? b.client_detail?.name ?? "";
        return an.localeCompare(bn);
      });
  }, [orgClassifications, fClass, fSearch, clientsByUid]);

  const stats = useMemo(() => {
    const counts = { A: 0, B: 0, C: 0, D: 0, unclassified: 0 };
    orgClassifications.forEach((cc) => {
      const key = cc.classification as ClassKey;
      if (key && counts[key] !== undefined) counts[key]++;
      else counts.unclassified++;
    });
    return { ...counts, total: orgClassifications.length };
  }, [orgClassifications]);

  const classifiedClientUids = useMemo<Set<string>>(() => {
    return new Set(orgClassifications.map((cc) => cc.client));
  }, [orgClassifications]);

  const availableClientsForAdd = useMemo<MasterItem[]>(() => {
    if (!selectedOrgId) return [];
    return Array.from(clientsByUid.values())
      .filter((c) => c.orgs.includes(selectedOrgId))
      .filter((c) => !classifiedClientUids.has(c.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [clientsByUid, selectedOrgId, classifiedClientUids]);

  const handleExportCSV = (): void => {
    const headers = [
      "#",
      "Client",
      "Classification",
      "Revenue Tier",
      "Strategic",
      "Relationship",
      "Growth",
      "Risk",
      "Notes",
    ];
    const rows = displayRows.map((cc, i) => {
      const cli = clientsByUid.get(cc.client);
      const name = cli?.name ?? cc.client_detail?.name ?? "";
      return [
        i + 1,
        `"${name}"`,
        cc.classification || "",
        cc.revenue_tier || "",
        cc.strategic_importance || "",
        cc.relationship_health || "",
        cc.growth_potential || "",
        cc.risk_level || "",
        `"${(cc.notes || "").replace(/"/g, '""')}"`,
      ];
    });
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `client-classification${fOrg ? "-" + fOrg : ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleEdit = (cc: ClientClassificationDto): void => {
    setModalExisting(cc);
    setModalMode("edit");
  };

  const handleDelete = async (cc: ClientClassificationDto): Promise<void> => {
    const cli = clientsByUid.get(cc.client);
    const name = cli?.name ?? cc.client_detail?.name ?? "this client";
    if (!window.confirm(`Delete classification for ${name}?`)) return;
    try {
      await apiDelete(`/client_classifications/${cc.uid}/`);
      void load();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Delete failed: ${msg}`);
    }
  };

  const cardS = (color: string): CSSProperties => ({
    background: "#fff",
    borderRadius: 10,
    padding: "12px 20px",
    borderLeft: `4px solid ${color}`,
    boxShadow: "0 1px 4px rgba(0,0,0,.07)",
    minWidth: 100,
    textAlign: "center",
    flex: 1,
  });

  const addDisabled = !fOrg;

  return (
    <div style={{ padding: "10px 16px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div className="page-title">🏢 Client Classification</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => {
              if (addDisabled) return;
              setModalExisting(undefined);
              setModalMode("add");
            }}
            disabled={addDisabled}
            title={addDisabled ? "Select an organization first" : ""}
            style={{
              padding: "7px 14px",
              background: addDisabled ? "#cbd5e1" : "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 7,
              cursor: addDisabled ? "not-allowed" : "pointer",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            + Add Classification
          </button>
          <button
            onClick={handleExportCSV}
            style={{
              padding: "7px 14px",
              background: "#16a34a",
              color: "#fff",
              border: "none",
              borderRadius: 7,
              cursor: "pointer",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            ⬇ Export CSV
          </button>
        </div>
      </div>

      {/* Stats cards */}
      <div
        style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}
      >
        <div style={cardS("#2563eb")}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#2563eb" }}>
            {stats.total}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>
            Total Classified
          </div>
        </div>
        {(Object.entries(CLASS_CFG) as [ClassKey, ClassConfig][]).map(
          ([key, cfg]) => {
            return (
              <div key={key} style={cardS(cfg.color)}>
                <div
                  style={{ fontSize: 28, fontWeight: 800, color: cfg.color }}
                >
                  {stats[key]}
                </div>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>
                  {cfg.label} — {cfg.fullLabel.split(" - ")[1]}
                </div>
              </div>
            );
          },
        )}
        <div style={cardS("#6b7280")}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#6b7280" }}>
            {stats.unclassified}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>
            Added but Unclassified
          </div>
        </div>
      </div>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 12,
          padding: "8px 14px",
          background: "#f8fafc",
          borderRadius: 8,
          border: "1px solid #e2e8f0",
        }}
      >
        {(Object.entries(CLASS_CFG) as [ClassKey, ClassConfig][]).map(
          ([key, cfg]) => (
            <div
              key={key}
              style={{ fontSize: 11, color: cfg.color, fontWeight: 600 }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 18,
                  height: 18,
                  borderRadius: 4,
                  background: cfg.bg,
                  border: `1.5px solid ${cfg.color}`,
                  textAlign: "center",
                  lineHeight: "18px",
                  fontWeight: 800,
                  fontSize: 10,
                  marginRight: 4,
                }}
              >
                {cfg.label}
              </span>
              {cfg.desc}
            </div>
          ),
        )}
      </div>

      {/* Filters */}
      <div
        className="dm-filter-bar"
        style={{
          background: "#fff",
          borderRadius: 8,
          padding: "8px 14px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 12,
          border: "1px solid #e2e8f0",
          flexWrap: "wrap",
        }}
      >
        <input
          type="text"
          placeholder="Search client…"
          value={fSearch}
          onChange={(e) => setFSearch(e.target.value)}
          style={{ ...inpS, maxWidth: 200 }}
        />
        {orgNames.length > 0 && (
          <select
            style={{ ...inpS, maxWidth: 150 }}
            value={fOrg}
            onChange={(e) => setFOrg(e.target.value)}
          >
            <option value="">All Organizations</option>
            {orgNames.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        )}
        <select
          style={{ ...inpS, maxWidth: 180 }}
          value={fClass}
          onChange={(e) => setFClass(e.target.value)}
        >
          <option value="">All Classifications</option>
          {CLASSIFICATIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
          <option value="__none">Unclassified</option>
        </select>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#94a3b8" }}>
          {displayRows.length} rows
        </span>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>
          Loading…
        </div>
      ) : (
        <div
          className="sticky-table-wrap dm-box"
          style={{
            background: "#fff",
            borderRadius: 10,
            border: "1px solid #e2e8f0",
            boxShadow: "0 1px 4px rgba(0,0,0,.06)",
            overflowX: "auto",
          }}
        >
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
          >
            <thead>
              <tr>
                <th style={{ ...thS, width: 36 }}>#</th>
                <th style={{ ...thS, minWidth: 160 }}>Client</th>
                <th style={{ ...thS, minWidth: 140 }}>Classification</th>
                <th style={thS}>Revenue</th>
                <th style={thS}>Strategic</th>
                <th style={thS}>Relationship</th>
                <th style={thS}>Growth</th>
                <th style={thS}>Risk</th>
                <th style={{ ...thS, minWidth: 160 }}>Notes</th>
                <th style={{ ...thS, width: 80 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.length === 0 && (
                <tr>
                  <td
                    colSpan={10}
                    style={{
                      ...tdS,
                      textAlign: "center",
                      padding: 30,
                      color: "#94a3b8",
                      whiteSpace: "normal",
                    }}
                  >
                    No classifications yet. Click + Add to start.
                  </td>
                </tr>
              )}
              {displayRows.map((cc, i) => {
                const cli = clientsByUid.get(cc.client);
                const name = cli?.name ?? cc.client_detail?.name ?? "(unknown)";
                const cfg = CLASS_CFG[cc.classification as ClassKey];
                return (
                  <tr
                    key={cc.uid}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "#f8fafc")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "")
                    }
                  >
                    <td
                      style={{
                        ...tdS,
                        color: "#94a3b8",
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      {i + 1}
                    </td>
                    <td style={{ ...tdS, fontWeight: 700, color: "#1e293b" }}>
                      {name}
                      {cfg && (
                        <span
                          style={{
                            marginLeft: 8,
                            padding: "1px 8px",
                            borderRadius: 10,
                            fontSize: 10,
                            fontWeight: 800,
                            background: cfg.bg,
                            color: cfg.color,
                            border: `1px solid ${cfg.color}22`,
                          }}
                        >
                          {cfg.label}
                        </span>
                      )}
                    </td>
                    <td style={tdS}>
                      {cfg ? cfg.fullLabel : cc.classification || "—"}
                    </td>
                    <td style={tdS}>{cc.revenue_tier || "—"}</td>
                    <td style={tdS}>{cc.strategic_importance || "—"}</td>
                    <td style={tdS}>{cc.relationship_health || "—"}</td>
                    <td style={tdS}>{cc.growth_potential || "—"}</td>
                    <td style={tdS}>{cc.risk_level || "—"}</td>
                    <td style={{ ...tdS, whiteSpace: "normal", maxWidth: 240 }}>
                      {cc.notes || "—"}
                    </td>
                    <td style={tdS}>
                      <button
                        onClick={() => handleEdit(cc)}
                        title="Edit"
                        style={{
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          fontSize: 14,
                          padding: "2px 6px",
                        }}
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => void handleDelete(cc)}
                        title="Delete"
                        style={{
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          fontSize: 14,
                          padding: "2px 6px",
                        }}
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalMode &&
        (() => {
          // Edit uses the record's own org (the filter may be "All Orgs").
          // Add still needs a header org — that's what scopes the client picker.
          if (modalMode === "edit" && modalExisting) {
            const recOrg = orgs.find((o) => o.id === modalExisting.org_uid);
            return (
              <ClientClassificationModal
                mode="edit"
                org={recOrg?.name ?? ""}
                orgId={modalExisting.org_uid}
                existing={modalExisting}
                availableClients={availableClientsForAdd}
                onClose={() => {
                  setModalMode(null);
                  setModalExisting(undefined);
                }}
                onSaved={() => void load()}
              />
            );
          }
          if (modalMode === "add" && fOrg && selectedOrgId) {
            return (
              <ClientClassificationModal
                mode="add"
                org={fOrg}
                orgId={selectedOrgId}
                existing={modalExisting}
                availableClients={availableClientsForAdd}
                onClose={() => {
                  setModalMode(null);
                  setModalExisting(undefined);
                }}
                onSaved={() => void load()}
              />
            );
          }
          return null;
        })()}

      {/* PACE context */}
      <div
        style={{
          marginTop: 16,
          padding: "12px 16px",
          background: "#eff6ff",
          border: "1px solid #bfdbfe",
          borderRadius: 8,
          fontSize: 12,
          color: "#1e40af",
          lineHeight: 1.6,
        }}
      >
        <strong>📌 PACE Customer Classification Guide:</strong>
        <br />
        <strong>A — Amazing:</strong> Highest value clients. Invest maximum
        effort in retention & growth.
        <br />
        <strong>B — Breadwinning:</strong> Reliable revenue generators. Maintain
        strong service & look for upsell.
        <br />
        <strong>C — Convenience:</strong> Low-effort clients. Serve efficiently,
        don't over-invest.
        <br />
        <strong>D — Dangerous:</strong> High-risk, resource-draining. Plan exit
        strategy or renegotiate terms.
      </div>
    </div>
  );
}
