import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import {
  ApiError,
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  ws,
} from "@/lib/api";
import { fmtDate } from "@/utils/date";
import type { Profile } from "@/types";
import { useAuth } from "@/hooks/useAuth";

import type {
  HolidayCreate,
  HolidayDto,
  HolidayTypeValue,
  HolidayUpdate,
} from "@/types/api";

const TYPES: HolidayTypeValue[] = ["National", "Regional", "Company"];
const TYPE_CFG: Record<HolidayTypeValue, { color: string; bg: string }> = {
  National: { color: "#dc2626", bg: "#fef2f2" },
  Regional: { color: "#d97706", bg: "#fef3c7" },
  Company: { color: "#2563eb", bg: "#eff6ff" },
};

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const getDayName = (d: string | null | undefined): string =>
  d ? DAYS[new Date(d + "T00:00:00").getDay()] : "";

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
  padding: "8px 10px",
  border: "2px solid #e2e8f0",
  borderRadius: 6,
  fontSize: 13,
  width: "100%",
  boxSizing: "border-box",
  background: "#fff",
  fontFamily: "inherit",
};

interface HolidayRow {
  id: string;
  name: string;
  date: string;
  day: string;
  type: HolidayTypeValue;
}

function dtoToRow(dto: HolidayDto): HolidayRow {
  return {
    id: dto.uid,
    name: dto.name,
    date: dto.date,
    day: dto.day,
    type: dto.type,
  };
}

interface ModalState {
  item?: HolidayRow;
}

interface HolidayMasterPageProps {
  profile: Profile | null;
}

export default function HolidayMasterPage({ profile: _profile }: HolidayMasterPageProps) {
  const { isAdminInAny } = useAuth();
  const [holidays, setHolidays] = useState<HolidayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [formName, setFormName] = useState("");
  const [formDate, setFormDate] = useState("");
  const [formType, setFormType] = useState<HolidayTypeValue>("National");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [fYear, setFYear] = useState(() => String(new Date().getFullYear()));
  const [fType, setFType] = useState<HolidayTypeValue | "">("");

  const isAdmin = isAdminInAny();

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const dtos = await apiGet<HolidayDto[]>("/holidays/");
      setHolidays(
        dtos.map(dtoToRow).sort((a, b) => a.date.localeCompare(b.date)),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const unsubscribe = ws.subscribe<HolidayDto>("holidays", () => {
      void load();
    });
    return unsubscribe;
  }, [load]);

  const years = useMemo(() => {
    const yrs = new Set<string>(
      holidays.map((h) => h.date.slice(0, 4)).filter(Boolean),
    );
    yrs.add(String(new Date().getFullYear()));
    return [...yrs].sort();
  }, [holidays]);

  const filtered = useMemo(
    () =>
      holidays
        .filter((h) => !fYear || h.date.startsWith(fYear))
        .filter((h) => !fType || h.type === fType),
    [holidays, fYear, fType],
  );

  const openAdd = (): void => {
    setFormName("");
    setFormDate("");
    setFormType("National");
    setModal({});
  };
  const openEdit = (item: HolidayRow): void => {
    setFormName(item.name);
    setFormDate(item.date);
    setFormType(item.type);
    setModal({ item });
  };
  const closeModal = (): void => setModal(null);

  const handleSave = async (): Promise<void> => {
    if (!formName.trim()) {
      alert("Holiday name is required");
      return;
    }
    if (!formDate) {
      alert("Date is required");
      return;
    }
    setSaving(true);
    try {
      const body: HolidayCreate = {
        name: formName.trim(),
        date: formDate,
        type: formType,
      };
      if (modal?.item?.id) {
        const patch: HolidayUpdate = body;
        await apiPatch<HolidayDto>(`/holidays/${modal.item.id}/`, patch);
      } else {
        await apiPost<HolidayDto>("/holidays/", body);
      }
      closeModal();
      await load();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Save failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    if (!window.confirm("Delete this holiday?")) return;
    setDeleting(id);
    try {
      await apiDelete(`/holidays/${id}/`);
      await load();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Delete failed: ${msg}`);
    } finally {
      setDeleting(null);
    }
  };

  const stats = useMemo(
    () => ({
      total: filtered.length,
      national: filtered.filter((h) => h.type === "National").length,
      regional: filtered.filter((h) => h.type === "Regional").length,
      company: filtered.filter((h) => h.type === "Company").length,
    }),
    [filtered],
  );

  const cardS = (color: string): CSSProperties => ({
    background: "#fff",
    borderRadius: 8,
    padding: "8px 16px",
    borderTop: `3px solid ${color}`,
    boxShadow: "0 1px 4px rgba(0,0,0,.07)",
    minWidth: 90,
    textAlign: "center",
  });

  const isPast = (d: string): boolean =>
    !!d && d < new Date().toISOString().slice(0, 10);

  return (
    <div style={{ padding: "10px 16px", maxWidth: 1000, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <div className="page-title">📅 Holiday Master</div>
        {isAdmin && (
          <button
            onClick={openAdd}
            style={{
              padding: "7px 16px",
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 7,
              cursor: "pointer",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            + Add Holiday
          </button>
        )}
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <div className="dm-stat-card" style={cardS("#2563eb")}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#2563eb" }}>
            {stats.total}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>
            Total
          </div>
        </div>
        <div className="dm-stat-card" style={cardS("#dc2626")}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#dc2626" }}>
            {stats.national}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>
            National
          </div>
        </div>
        <div className="dm-stat-card" style={cardS("#d97706")}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#d97706" }}>
            {stats.regional}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>
            Regional
          </div>
        </div>
        <div className="dm-stat-card" style={cardS("#2563eb")}>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#0891b2" }}>
            {stats.company}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>
            Company
          </div>
        </div>
      </div>

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
        }}
      >
        <select
          style={{ ...inpS, maxWidth: 120 }}
          value={fYear}
          onChange={(e) => setFYear(e.target.value)}
        >
          <option value="">All Years</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <select
          style={{ ...inpS, maxWidth: 130 }}
          value={fType}
          onChange={(e) => setFType(e.target.value as HolidayTypeValue | "")}
        >
          <option value="">All Types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <span
          style={{ marginLeft: "auto", fontSize: 12, color: "#94a3b8" }}
        >
          {filtered.length} holidays
        </span>
      </div>

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
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
            }}
          >
            <thead>
              <tr>
                <th style={{ ...thS, width: 36 }}>#</th>
                <th style={{ ...thS, width: 120 }}>Date</th>
                <th style={{ ...thS, width: 100 }}>Day</th>
                <th style={thS}>Holiday</th>
                <th style={{ ...thS, width: 100 }}>Type</th>
                {isAdmin && <th style={{ ...thS, width: 80 }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={isAdmin ? 6 : 5}
                    style={{
                      ...tdS,
                      textAlign: "center",
                      padding: 30,
                      color: "#94a3b8",
                    }}
                  >
                    No holidays found for {fYear || "any year"}.
                  </td>
                </tr>
              )}
              {filtered.map((h, i) => {
                const tc = TYPE_CFG[h.type];
                const past = isPast(h.date);
                return (
                  <tr
                    key={h.id}
                    style={{
                      opacity: past ? 0.6 : 1,
                      transition: "background .12s",
                    }}
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
                        fontWeight: 600,
                        fontSize: 11,
                      }}
                    >
                      {i + 1}
                    </td>
                    <td
                      style={{ ...tdS, fontWeight: 600, fontSize: 12 }}
                    >
                      {fmtDate(h.date)}
                    </td>
                    <td style={{ ...tdS, fontSize: 12 }}>
                      {h.day || getDayName(h.date)}
                    </td>
                    <td
                      style={{
                        ...tdS,
                        fontWeight: 600,
                        color: "#1e293b",
                      }}
                    >
                      {h.name}
                    </td>
                    <td style={tdS}>
                      <span
                        style={{
                          padding: "2px 8px",
                          borderRadius: 10,
                          fontSize: 10,
                          fontWeight: 700,
                          background: tc.bg,
                          color: tc.color,
                        }}
                      >
                        {h.type}
                      </span>
                    </td>
                    {isAdmin && (
                      <td style={{ ...tdS, whiteSpace: "nowrap" }}>
                        <button
                          onClick={() => openEdit(h)}
                          title="Edit"
                          style={{
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            fontSize: 14,
                            padding: "2px 4px",
                          }}
                        >
                          ✏️
                        </button>
                        <button
                          onClick={() => {
                            void handleDelete(h.id);
                          }}
                          title="Delete"
                          disabled={deleting === h.id}
                          style={{
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            fontSize: 14,
                            padding: "2px 4px",
                            opacity: deleting === h.id ? 0.5 : 1,
                          }}
                        >
                          🗑️
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.45)",
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
              borderRadius: 14,
              padding: 28,
              minWidth: 380,
              maxWidth: 460,
              boxShadow: "0 20px 60px rgba(0,0,0,.25)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 20,
              }}
            >
              <span
                style={{
                  fontWeight: 800,
                  fontSize: 18,
                  fontFamily: "var(--font-heading)",
                  color: "var(--txt)",
                }}
              >
                {modal.item ? "✏️ Edit Holiday" : "➕ Add Holiday"}
              </span>
              <button
                onClick={closeModal}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: 20,
                  cursor: "pointer",
                  color: "#64748b",
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#475569",
                  display: "block",
                  marginBottom: 4,
                  textTransform: "uppercase",
                  letterSpacing: ".5px",
                }}
              >
                Holiday Name *
              </label>
              <input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Diwali"
                autoFocus
                style={inpS}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSave();
                }}
              />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 14,
                marginBottom: 16,
              }}
            >
              <div>
                <label
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#475569",
                    display: "block",
                    marginBottom: 4,
                    textTransform: "uppercase",
                    letterSpacing: ".5px",
                  }}
                >
                  Date *
                </label>
                <input
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  style={inpS}
                />
              </div>
              <div>
                <label
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#475569",
                    display: "block",
                    marginBottom: 4,
                    textTransform: "uppercase",
                    letterSpacing: ".5px",
                  }}
                >
                  Day
                </label>
                <input
                  readOnly
                  value={formDate ? getDayName(formDate) : "—"}
                  style={{
                    ...inpS,
                    background: "#f8fafc",
                    color: "#64748b",
                  }}
                />
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#475569",
                  display: "block",
                  marginBottom: 4,
                  textTransform: "uppercase",
                  letterSpacing: ".5px",
                }}
              >
                Type
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                {TYPES.map((t) => {
                  const tc = TYPE_CFG[t];
                  const sel = formType === t;
                  return (
                    <button
                      key={t}
                      onClick={() => setFormType(t)}
                      style={{
                        flex: 1,
                        padding: "8px 12px",
                        borderRadius: 8,
                        cursor: "pointer",
                        fontWeight: 700,
                        fontSize: 13,
                        border: `2px solid ${sel ? tc.color : "#e2e8f0"}`,
                        background: sel ? tc.bg : "#fff",
                        color: sel ? tc.color : "#64748b",
                        transition: "all .15s",
                      }}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>

            <div
              style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}
            >
              <button
                onClick={closeModal}
                style={{
                  padding: "8px 18px",
                  border: "1px solid #e2e8f0",
                  background: "#f8fafc",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: 13,
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void handleSave();
                }}
                disabled={saving}
                style={{
                  padding: "8px 18px",
                  background: "#2563eb",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: 13,
                  opacity: saving ? 0.7 : 1,
                }}
              >
                {saving ? "Saving…" : modal.item ? "Update" : "Add Holiday"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
