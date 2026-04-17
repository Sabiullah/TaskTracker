import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  ApiError,
  apiGet,
  apiPatch,
  apiPost,
  ws,
} from "@/lib/api";
import { useMasters } from "@/hooks/useMasters";
import { useOrgs } from "@/hooks/useOrgs";
import type { Profile, MasterItem } from "@/types";
import type { ClientClassificationDto } from "@/types/api";
import { parseOrg } from "@/utils/org";

interface PaceClientClassPageProps {
  profile: Profile | null;
}

const CLASSIFICATIONS = [
  "A - Amazing",
  "B - Breadwinning",
  "C - Convenience",
  "D - Dangerous",
] as const;
type ClassKey = (typeof CLASSIFICATIONS)[number];

const CLASS_SHORT: Record<ClassKey, "A" | "B" | "C" | "D"> = {
  "A - Amazing": "A",
  "B - Breadwinning": "B",
  "C - Convenience": "C",
  "D - Dangerous": "D",
};

interface ClassConfig {
  color: string;
  bg: string;
  label: string;
  desc: string;
}

const CLASS_CFG: Record<ClassKey, ClassConfig> = {
  "A - Amazing": {
    color: "#16a34a",
    bg: "#f0fdf4",
    label: "A",
    desc: "Amazing — Top clients, highest value, strongest relationships",
  },
  "B - Breadwinning": {
    color: "#2563eb",
    bg: "#eff6ff",
    label: "B",
    desc: "Breadwinning — Reliable revenue, consistent business",
  },
  "C - Convenience": {
    color: "#d97706",
    bg: "#fef3c7",
    label: "C",
    desc: "Convenience — Low effort, moderate returns",
  },
  "D - Dangerous": {
    color: "#dc2626",
    bg: "#fef2f2",
    label: "D",
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

type ClientWithOrgs = MasterItem & { resolvedOrgs: string[] };

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

  const orgNames = useMemo(() => orgs.map((o) => o.name), [orgs]);

  const clientsWithOrgs = useMemo<ClientWithOrgs[]>(
    () =>
      allClients.map((c) => ({
        ...c,
        resolvedOrgs: parseOrg(c.org),
      })),
    [allClients],
  );

  // Filter clients by selected org
  const filteredClients = useMemo<ClientWithOrgs[]>(() => {
    return clientsWithOrgs
      .filter((c) => {
        if (!fOrg) return true;
        return c.resolvedOrgs.includes(fOrg);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [clientsWithOrgs, fOrg]);

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

  const getClass = useCallback(
    (clientUid: string): ClientClassificationDto | undefined =>
      classifications.find((c) => c.client === clientUid),
    [classifications],
  );

  const saveField = async (
    clientUid: string,
    field: "classification" | "notes",
    value: string,
  ): Promise<void> => {
    const existing = getClass(clientUid);
    try {
      if (existing) {
        await apiPatch<ClientClassificationDto>(
          `/client_classifications/${existing.uid}/`,
          { [field]: value },
        );
      } else {
        await apiPost<ClientClassificationDto>(
          "/client_classifications/upsert/",
          { client: clientUid, [field]: value },
        );
      }
      // WS will refresh the cache, but push an optimistic reload too.
      void load();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Save failed: ${msg}`);
    }
  };

  // Derived data
  const displayClients = useMemo<ClientWithOrgs[]>(() => {
    return filteredClients.filter((client) => {
      const cls = getClass(client.id);
      if (fClass === "__none") return !cls?.classification;
      if (fClass && (!cls || cls.classification !== fClass)) return false;
      if (fSearch) {
        const q = fSearch.toLowerCase();
        return (
          client.name.toLowerCase().includes(q) ||
          (cls?.notes || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [filteredClients, fClass, fSearch, getClass]);

  const stats = useMemo(() => {
    const counts = { A: 0, B: 0, C: 0, D: 0, unclassified: 0 };
    filteredClients.forEach((client) => {
      const cls = getClass(client.id);
      const short = cls?.classification
        ? CLASS_SHORT[cls.classification as ClassKey]
        : null;
      if (short && counts[short] !== undefined) counts[short]++;
      else counts.unclassified++;
    });
    return { ...counts, total: filteredClients.length };
  }, [filteredClients, getClass]);

  const handleExportCSV = (): void => {
    const headers = ["#", "Client", "Classification", "Notes"];
    const rows = displayClients.map((client, i) => {
      const cls = getClass(client.id);
      return [
        i + 1,
        `"${client.name}"`,
        cls?.classification || "",
        `"${(cls?.notes || "").replace(/"/g, '""')}"`,
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

      {/* Stats cards */}
      <div
        style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}
      >
        <div style={cardS("#2563eb")}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#2563eb" }}>
            {stats.total}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>
            Total Clients
          </div>
        </div>
        {(Object.entries(CLASS_CFG) as [ClassKey, ClassConfig][]).map(
          ([key, cfg]) => {
            const short = CLASS_SHORT[key];
            return (
              <div key={key} style={cardS(cfg.color)}>
                <div
                  style={{ fontSize: 28, fontWeight: 800, color: cfg.color }}
                >
                  {stats[short]}
                </div>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>
                  {cfg.label} — {key.split(" - ")[1]}
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
            Unclassified
          </div>
        </div>
      </div>

      {/* Classification legend */}
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
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          <option value="__none">Unclassified</option>
        </select>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#94a3b8" }}>
          {displayClients.length} clients
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
          }}
        >
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
          >
            <thead>
              <tr>
                <th style={{ ...thS, width: 36 }}>#</th>
                <th style={{ ...thS, minWidth: 180 }}>Client</th>
                <th style={{ ...thS, width: 180 }}>Classification</th>
                <th style={{ ...thS, minWidth: 180 }}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {displayClients.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    style={{
                      ...tdS,
                      textAlign: "center",
                      padding: 30,
                      color: "#94a3b8",
                    }}
                  >
                    No clients found.
                  </td>
                </tr>
              )}
              {displayClients.map((client, i) => {
                const cls = getClass(client.id);
                const classification = cls?.classification || "";
                const cfg = CLASS_CFG[classification as ClassKey];
                return (
                  <tr
                    key={client.id}
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
                      {client.name}
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
                      <select
                        value={classification}
                        onChange={(e) =>
                          saveField(
                            client.id,
                            "classification",
                            e.target.value,
                          )
                        }
                        style={{
                          ...inpS,
                          fontSize: 12,
                          fontWeight: 600,
                          padding: "5px 8px",
                          color: cfg?.color || "#6b7280",
                          borderColor: cfg?.color
                            ? cfg.color + "44"
                            : "#e2e8f0",
                          background: cfg?.bg || "#fff",
                        }}
                      >
                        <option value="">— Select —</option>
                        {CLASSIFICATIONS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={tdS}>
                      <input
                        style={{ ...inpS, fontSize: 12, padding: "5px 8px" }}
                        defaultValue={cls?.notes || ""}
                        placeholder="Notes…"
                        onBlur={(e) => {
                          if (e.target.value !== (cls?.notes || ""))
                            void saveField(client.id, "notes", e.target.value);
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

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
