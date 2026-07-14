import { useState, useEffect, useMemo } from "react";
import type { CSSProperties } from "react";
import { useAuth } from "@/hooks/useAuth";
import { toMins, fromMins } from "@/utils/time";
import { TODAY } from "@/utils/date";
import DrillModal from "./DrillModal";
import type { WorkLog } from "@/types";
import type {
  ChartMode,
  DailyStat,
  DrillState,
  MonthlyStat,
  WeeklyStat,
} from "@/types/workLogDashboard";
import {
  computeClientStats,
  computeDailyStats,
  computeMemberStats,
  computeMonthlyStats,
  computeWeeklyStats,
} from "@/utils/workLogDashboard";
import {
  renderDashboardImage,
  shareImageFile,
  downloadBlob,
} from "@/utils/dashboardImage";
import { buildDashboardCaption } from "@/utils/worklogShare";

interface OrgOption {
  readonly uid: string;
  readonly name: string;
}

interface WorkLogDashboardProps {
  logs: WorkLog[];
  isAdmin: boolean;
  isManager: boolean;
  myName: string;
  selectedOrg?: string;
  /** Every org the current user can filter by. Value = uid, label = name.
   *  String-array form was misleading: the filter compares ``r.organization``
   *  (a uid) against ``fOrg``, so passing names meant the dropdown silently
   *  filtered every row out. */
  allOrgs?: readonly OrgOption[];
}

export default function WorkLogDashboard({
  logs,
  isAdmin,
  isManager,
  myName,
  selectedOrg = "",
  allOrgs = [],
}: WorkLogDashboardProps) {
  // `selectedOrg` (and therefore `fOrg`) holds the org uid, not the name —
  // look up the friendly name for display via AuthContext memberships.
  const { orgs } = useAuth();
  const orgNameByUid = useMemo(
    () => new Map(orgs.map((o) => [o.uid, o.name])),
    [orgs],
  );
  const [dMonth, setDMonth] = useState("");
  const [fMember, setFMember] = useState("");
  const [fClient, setFClient] = useState("");
  const [fOrg, setFOrg] = useState("");
  const [drill, setDrill] = useState<DrillState | null>(null);
  const [chartMode, setChartMode] = useState<ChartMode>("daily");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Sync the dashboard's org filter with the Log Table's selected org whenever it changes
  useEffect(() => {
    Promise.resolve().then(() => setFOrg(selectedOrg || ""));
  }, [selectedOrg]);

  const visible = useMemo(() => {
    let l = logs;
    if (!isAdmin && !isManager) l = l.filter((r) => r.name === myName);
    // Strict org match against the row's stored `organization` field — no client-map fallback.
    // This ensures the Dashboard reflects exactly what was saved in the Log Table, even when
    // a client is linked to multiple orgs (e.g. Allied → 4D + YBV).
    if (fOrg) l = l.filter((r) => (r.organization || "") === fOrg);
    if (dMonth) l = l.filter((r) => (r.date || "").startsWith(dMonth));
    if (dateFrom) l = l.filter((r) => (r.date || "") >= dateFrom);
    if (dateTo) l = l.filter((r) => (r.date || "") <= dateTo);
    if (fMember) l = l.filter((r) => r.name === fMember);
    if (fClient) l = l.filter((r) => (r.client || "") === fClient);
    return l;
  }, [
    logs,
    isAdmin,
    isManager,
    myName,
    fOrg,
    dMonth,
    fMember,
    fClient,
    dateFrom,
    dateTo,
  ]);

  const allMonths = [
    ...new Set(logs.map((r) => (r.date || "").slice(0, 7)).filter(Boolean)),
  ]
    .sort()
    .reverse();
  // Dropdown options derived from full log (not filtered) so options don't disappear
  const allMembers = useMemo(
    () =>
      [...new Set(logs.map((r) => r.name).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [logs],
  );
  const allClients = useMemo(
    () =>
      [...new Set(logs.map((r) => r.client).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [logs],
  );
  const totalMins = visible.reduce((s, r) => s + toMins(r.hours_worked), 0);
  // Today's worked minutes within the current filter scope.
  const todayMins = visible
    .filter((r) => r.date === TODAY)
    .reduce((s, r) => s + toMins(r.hours_worked), 0);

  const memberStats = useMemo(() => computeMemberStats(visible), [visible]);
  const clientStats = useMemo(() => computeClientStats(visible), [visible]);
  const dailyStats = useMemo(() => computeDailyStats(visible), [visible]);
  const weeklyStats = useMemo(() => computeWeeklyStats(visible), [visible]);
  const monthlyStats = useMemo(() => computeMonthlyStats(visible), [visible]);

  type ChartDatum = DailyStat | WeeklyStat | MonthlyStat;
  const chartData: ChartDatum[] =
    chartMode === "weekly"
      ? weeklyStats
      : chartMode === "monthly"
        ? monthlyStats
        : dailyStats;
  const chartLabel = (item: ChartDatum): string =>
    "week" in item
      ? `W ${item.week.slice(5)}`
      : "month" in item
        ? item.month.slice(0, 7)
        : item.date.slice(5);
  const maxDayMins = Math.max(...chartData.map((d) => d.mins), 1);
  const card = (c: string): CSSProperties => ({
    background: "#fff",
    borderRadius: 10,
    padding: "16px 20px",
    boxShadow: "0 1px 4px rgba(0,0,0,.08)",
    borderTop: `4px solid ${c}`,
  });

  const [sharingImg, setSharingImg] = useState(false);

  // Snapshot the dashboard (stats + trend chart + top members) to a PNG and
  // hand it to the OS share sheet (mobile → WhatsApp). Desktop, or any
  // platform that can't share files, downloads the PNG instead.
  const handleShareImage = async (): Promise<void> => {
    setSharingImg(true);
    try {
      const orgLabel = fOrg ? orgNameByUid.get(fOrg) || "" : "All Orgs";
      const rangeLabel =
        dMonth ||
        (dateFrom || dateTo ? `${dateFrom || "…"} → ${dateTo || "…"}` : "All time");
      const subtitleBits = [rangeLabel, orgLabel, fMember, fClient].filter(
        Boolean,
      );
      const chartTitle =
        chartMode === "daily"
          ? `Daily Trend (last ${chartData.length} days)`
          : chartMode === "weekly"
            ? `Weekly Comparison (last ${chartData.length} weeks)`
            : `Monthly Comparison (last ${chartData.length} months)`;

      const blob = await renderDashboardImage({
        title: "WORK LOG DASHBOARD",
        subtitle: subtitleBits.join(" · "),
        reportedBy: myName || undefined,
        stats: [
          { label: "Total Hours", value: fromMins(totalMins), color: "#2563eb" },
          { label: "Total Entries", value: String(visible.length), color: "#16a34a" },
          { label: "Active Members", value: String(memberStats.length), color: "#7c3aed" },
          {
            label: "Clients Served",
            value: String(clientStats.filter((c) => c.client !== "No Client").length),
            color: "#d97706",
          },
        ],
        chartTitle,
        bars: chartData.map((d) => ({
          label: chartLabel(d),
          value: fromMins(d.mins),
          mins: d.mins,
        })),
        todayHours: fromMins(todayMins),
        generatedAt: new Date().toLocaleString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
      });

      const caption = buildDashboardCaption({
        subtitle: subtitleBits.join(" · "),
        reportedBy: myName || undefined,
        totalHours: fromMins(totalMins),
        todayHours: fromMins(todayMins),
        entries: visible.length,
        members: memberStats.length,
        clients: clientStats.filter((c) => c.client !== "No Client").length,
      });

      const filename = `worklog-dashboard-${dMonth || "all"}.png`;
      const shared = await shareImageFile(blob, filename, caption);
      if (!shared) downloadBlob(blob, filename);
    } catch (err) {
      alert(
        `Could not generate the image: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setSharingImg(false);
    }
  };

  return (
    <div>
      {/* Filter bar — Month + Employee + Client + Date Range */}
      <div
        className="dm-filter-bar"
        style={{
          background: "#fff",
          borderRadius: 10,
          padding: "10px 14px",
          boxShadow: "0 1px 4px rgba(0,0,0,.08)",
          marginBottom: 16,
        }}
      >
        {/* Top row — all filters in one line */}
        <div
          className="wl-dash-filter-row"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "nowrap",
            overflowX: "auto",
          }}
        >
          {/* Month dropdown */}
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#64748b",
              whiteSpace: "nowrap",
            }}
          >
            📅 Month:
          </span>
          <select
            value={dMonth}
            onChange={(e) => setDMonth(e.target.value)}
            style={{
              padding: "5px 8px",
              border: `1px solid ${dMonth ? "#2563eb" : "#e2e8f0"}`,
              borderRadius: 6,
              fontSize: 12,
              width: 120,
              background: dMonth ? "#eff6ff" : "#fff",
              fontWeight: dMonth ? 700 : 400,
              cursor: "pointer",
            }}
          >
            <option value="">All Time</option>
            {allMonths.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>

          <span style={{ color: "#e2e8f0", fontSize: 18, flexShrink: 0 }}>
            |
          </span>

          {/* Org filter — synced with Log Table's selected org */}
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#64748b",
              whiteSpace: "nowrap",
            }}
          >
            🏛 Org:
          </span>
          <select
            value={fOrg}
            onChange={(e) => setFOrg(e.target.value)}
            style={{
              padding: "5px 8px",
              border: `1px solid ${fOrg ? "#2563eb" : "#e2e8f0"}`,
              borderRadius: 6,
              fontSize: 12,
              width: 110,
              background: fOrg ? "#eff6ff" : "#fff",
              fontWeight: fOrg ? 700 : 400,
              cursor: "pointer",
            }}
          >
            <option value="">All Orgs</option>
            {allOrgs.map((o) => (
              <option key={o.uid} value={o.uid}>
                {o.name}
              </option>
            ))}
          </select>

          <span style={{ color: "#e2e8f0", fontSize: 18, flexShrink: 0 }}>
            |
          </span>

          {/* Employee filter */}
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#64748b",
              whiteSpace: "nowrap",
            }}
          >
            👤 Employee:
          </span>
          <select
            value={fMember}
            onChange={(e) => setFMember(e.target.value)}
            style={{
              padding: "5px 8px",
              border: `1px solid ${fMember ? "#2563eb" : "#e2e8f0"}`,
              borderRadius: 6,
              fontSize: 12,
              width: 120,
              background: fMember ? "#eff6ff" : "#fff",
              fontWeight: fMember ? 700 : 400,
              cursor: "pointer",
            }}
          >
            <option value="">All Employees</option>
            {allMembers.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>

          <span style={{ color: "#e2e8f0", fontSize: 18, flexShrink: 0 }}>
            |
          </span>

          {/* Client filter */}
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#64748b",
              whiteSpace: "nowrap",
            }}
          >
            🏢 Client:
          </span>
          <select
            value={fClient}
            onChange={(e) => setFClient(e.target.value)}
            style={{
              padding: "5px 8px",
              border: `1px solid ${fClient ? "#2563eb" : "#e2e8f0"}`,
              borderRadius: 6,
              fontSize: 12,
              width: 120,
              background: fClient ? "#eff6ff" : "#fff",
              fontWeight: fClient ? 700 : 400,
              cursor: "pointer",
            }}
          >
            <option value="">All Clients</option>
            {allClients.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <span style={{ color: "#e2e8f0", fontSize: 18, flexShrink: 0 }}>
            |
          </span>

          {/* Date range — both in same row */}
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#64748b",
              whiteSpace: "nowrap",
            }}
          >
            📆 From:
          </span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            style={{
              padding: "4px 6px",
              border: "1px solid #e2e8f0",
              borderRadius: 6,
              fontSize: 12,
              width: 128,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#64748b",
              whiteSpace: "nowrap",
            }}
          >
            To:
          </span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            style={{
              padding: "4px 6px",
              border: "1px solid #e2e8f0",
              borderRadius: 6,
              fontSize: 12,
              width: 128,
              flexShrink: 0,
            }}
          />

          {/* Clear filters */}
          {(dMonth || fMember || fClient || fOrg || dateFrom || dateTo) && (
            <button
              onClick={() => {
                setDMonth("");
                setFMember("");
                setFClient("");
                setFOrg("");
                setDateFrom("");
                setDateTo("");
              }}
              style={{
                padding: "4px 10px",
                fontSize: 11,
                borderRadius: 6,
                border: "1px solid #fecaca",
                background: "#fff1f2",
                color: "#dc2626",
                cursor: "pointer",
                fontWeight: 600,
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              ✕ Clear
            </button>
          )}
        </div>

        {/* Badge row — only when filters active */}
        {(dMonth || fMember || fClient || fOrg || dateFrom || dateTo) && (
          <div
            style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 8 }}
          >
            {fOrg && (
              <span
                style={{
                  padding: "2px 8px",
                  borderRadius: 12,
                  background: "#eff6ff",
                  color: "#2563eb",
                  fontSize: 11,
                  fontWeight: 700,
                  border: "1px solid #bfdbfe",
                }}
              >
                🏛 {orgNameByUid.get(fOrg) ?? fOrg}
                {selectedOrg === fOrg && (
                  <span style={{ fontWeight: 400, marginLeft: 4 }}>
                    (from Log Table)
                  </span>
                )}
                <button
                  onClick={() => setFOrg("")}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#2563eb",
                    fontSize: 11,
                    marginLeft: 4,
                    padding: 0,
                    fontWeight: 700,
                  }}
                >
                  ×
                </button>
              </span>
            )}
            {fMember && (
              <span
                style={{
                  padding: "2px 8px",
                  borderRadius: 12,
                  background: "#dbeafe",
                  color: "#1d4ed8",
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                👤 {fMember}
                <button
                  onClick={() => setFMember("")}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#1d4ed8",
                    fontSize: 11,
                    marginLeft: 4,
                    padding: 0,
                    fontWeight: 700,
                  }}
                >
                  ×
                </button>
              </span>
            )}
            {fClient && (
              <span
                style={{
                  padding: "2px 8px",
                  borderRadius: 12,
                  background: "#dcfce7",
                  color: "#15803d",
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                🏢 {fClient}
                <button
                  onClick={() => setFClient("")}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#15803d",
                    fontSize: 11,
                    marginLeft: 4,
                    padding: 0,
                    fontWeight: 700,
                  }}
                >
                  ×
                </button>
              </span>
            )}
            {(dateFrom || dateTo) && (
              <span
                style={{
                  padding: "2px 8px",
                  borderRadius: 12,
                  background: "#fef9c3",
                  color: "#92400e",
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                📆 {dateFrom || "…"} → {dateTo || "…"}
                <button
                  onClick={() => {
                    setDateFrom("");
                    setDateTo("");
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#92400e",
                    fontSize: 11,
                    marginLeft: 4,
                    padding: 0,
                    fontWeight: 700,
                  }}
                >
                  ×
                </button>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div
        className="wl-dash-cards"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div className="dm-stat-card" style={card("#2563eb")}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#2563eb" }}>
            {fromMins(totalMins)}
          </div>
          <div
            className="dm-stat-lbl"
            style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}
          >
            Total Hours
          </div>
        </div>
        <div className="dm-stat-card" style={card("#16a34a")}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#16a34a" }}>
            {visible.length}
          </div>
          <div
            className="dm-stat-lbl"
            style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}
          >
            Total Entries
          </div>
        </div>
        <div className="dm-stat-card" style={card("#7c3aed")}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#7c3aed" }}>
            {memberStats.length}
          </div>
          <div
            className="dm-stat-lbl"
            style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}
          >
            Active Members
          </div>
        </div>
        <div className="dm-stat-card" style={card("#d97706")}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#d97706" }}>
            {clientStats.filter((c) => c.client !== "No Client").length}
          </div>
          <div
            className="dm-stat-lbl"
            style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}
          >
            Clients Served
          </div>
        </div>
      </div>

      <div
        className="wl-dash-2col"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 14,
          marginBottom: 14,
        }}
      >
        {/* Member performance */}
        <div
          className="dm-box"
          style={{
            background: "#fff",
            borderRadius: 10,
            padding: 16,
            boxShadow: "0 1px 4px rgba(0,0,0,.08)",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
            👤 Member Performance
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 10 }}>
            Click member name or any value to view entries
          </div>
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
          >
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                {["Member", "Entries", "Hours", "Days", "Clients"].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "7px 10px",
                      textAlign: "left",
                      fontWeight: 700,
                      color: "#475569",
                      fontSize: 12,
                      borderBottom: "2px solid #e2e8f0",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {memberStats.map((m, i) => {
                const memberRows = visible.filter((r) => r.name === m.name);
                const openMember = () =>
                  setDrill({
                    title: `👤 ${m.name} — Work Log`,
                    rows: memberRows,
                  });
                return (
                  <tr
                    key={m.name}
                    style={{
                      borderBottom: "1px solid #f1f5f9",
                      background: i % 2 === 0 ? "#fff" : "#fafafa",
                      cursor: "pointer",
                    }}
                    onClick={openMember}
                    title="Click to view all entries"
                  >
                    <td
                      style={{
                        padding: "7px 10px",
                        fontWeight: 700,
                        color: "#2563eb",
                        textDecoration: "underline",
                      }}
                    >
                      {m.name}
                    </td>
                    <td
                      style={{
                        padding: "7px 10px",
                        color: "#2563eb",
                        fontWeight: 600,
                        textDecoration: "underline",
                      }}
                    >
                      {m.count}
                    </td>
                    <td
                      style={{
                        padding: "7px 10px",
                        fontWeight: 700,
                        color: "#2563eb",
                        textDecoration: "underline",
                      }}
                    >
                      {fromMins(m.mins)}
                    </td>
                    <td style={{ padding: "7px 10px", color: "#64748b" }}>
                      {m.days.size}
                    </td>
                    <td style={{ padding: "7px 10px", color: "#64748b" }}>
                      {m.clients.size}
                    </td>
                  </tr>
                );
              })}
              {memberStats.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    style={{
                      padding: 16,
                      textAlign: "center",
                      color: "#94a3b8",
                    }}
                  >
                    No data
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Client performance */}
        <div
          className="dm-box"
          style={{
            background: "#fff",
            borderRadius: 10,
            padding: 16,
            boxShadow: "0 1px 4px rgba(0,0,0,.08)",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
            🏢 Client-wise Hours
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 10 }}>
            Click client name to view entries
          </div>
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {clientStats.map((c) => {
              const pct = Math.round((c.mins / Math.max(totalMins, 1)) * 100);
              const clientRows = visible.filter(
                (r) => (r.client || "No Client") === c.client,
              );
              return (
                <div
                  key={c.client}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <button
                    onClick={() =>
                      setDrill({
                        title: `🏢 ${c.client} — Work Log`,
                        rows: clientRows,
                      })
                    }
                    style={{
                      width: 110,
                      fontSize: 12,
                      fontWeight: 700,
                      color: "#2563eb",
                      background: "none",
                      border: "none",
                      padding: 0,
                      textAlign: "left",
                      cursor: "pointer",
                      textDecoration: "underline",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                    title={`Click to view ${c.client} entries`}
                  >
                    {c.client}
                  </button>
                  <div
                    style={{
                      flex: 1,
                      height: 10,
                      background: "#e5e7eb",
                      borderRadius: 5,
                    }}
                  >
                    <div
                      style={{
                        width: `${pct}%`,
                        height: "100%",
                        background: "#2563eb",
                        borderRadius: 5,
                        minWidth: 4,
                      }}
                    />
                  </div>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: "#2563eb",
                      minWidth: 42,
                      textAlign: "right",
                    }}
                  >
                    {fromMins(c.mins)}
                  </span>
                  <span
                    style={{ fontSize: 11, color: "#94a3b8", minWidth: 28 }}
                  >
                    {pct}%
                  </span>
                </div>
              );
            })}
            {clientStats.length === 0 && (
              <p style={{ color: "#94a3b8", fontSize: 13 }}>No data</p>
            )}
          </div>
        </div>
      </div>

      {/* Drill-down modal */}
      {drill && (
        <DrillModal
          title={drill.title}
          rows={drill.rows}
          onClose={() => setDrill(null)}
        />
      )}

      {/* Trend Chart */}
      {chartData.length > 0 && (
        <div
          className="dm-box"
          style={{
            background: "#fff",
            borderRadius: 10,
            padding: 16,
            boxShadow: "0 1px 4px rgba(0,0,0,.08)",
          }}
        >
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
            <div style={{ fontSize: 14, fontWeight: 700 }}>
              📊{" "}
              {chartMode === "daily"
                ? `Daily Trend (last ${chartData.length} days)`
                : chartMode === "weekly"
                  ? `Weekly Comparison (last ${chartData.length} weeks)`
                  : `Monthly Comparison (last ${chartData.length} months)`}
            </div>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              {(
                [
                  ["daily", "Daily"],
                  ["weekly", "Weekly"],
                  ["monthly", "Monthly"],
                ] as const
              ).map(([m, l]) => (
                <button
                  key={m}
                  onClick={() => setChartMode(m)}
                  style={{
                    padding: "4px 12px",
                    borderRadius: 16,
                    border: "none",
                    cursor: "pointer",
                    fontSize: 11,
                    fontWeight: 700,
                    background: chartMode === m ? "#2563eb" : "#f1f5f9",
                    color: chartMode === m ? "#fff" : "#64748b",
                  }}
                >
                  {l}
                </button>
              ))}
              <button
                onClick={() => {
                  void handleShareImage();
                }}
                disabled={sharingImg}
                title="Share this dashboard as an image (WhatsApp, etc.)"
                style={{
                  marginLeft: 6,
                  padding: "5px 12px",
                  borderRadius: 16,
                  border: "none",
                  cursor: sharingImg ? "default" : "pointer",
                  fontSize: 11,
                  fontWeight: 700,
                  background: "#d32553",
                  color: "#fff",
                  opacity: sharingImg ? 0.6 : 1,
                }}
              >
                {sharingImg ? "…" : "📷 Share"}
              </button>
            </div>
          </div>
          {/* chart: fixed bottom-aligned area + x-axis labels below */}
          <div style={{ overflowX: "auto" }}>
            {/* bar area */}
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                gap: 6,
                height: 160,
                paddingBottom: 0,
                minWidth: "max-content",
              }}
            >
              {chartData.map((d) => {
                const mins = d.mins;
                const BAR_MAX = 140;
                const h = Math.max(
                  Math.round((mins / maxDayMins) * BAR_MAX),
                  6,
                );
                const label = chartLabel(d);
                const barColor =
                  chartMode === "monthly"
                    ? "#7c3aed"
                    : chartMode === "weekly"
                      ? "#0891b2"
                      : "#2563eb";
                const valueStr = fromMins(mins);
                const insideBar = h >= 28; // enough room to show value inside
                const barW =
                  chartMode === "monthly"
                    ? 48
                    : chartMode === "weekly"
                      ? 40
                      : 32;
                return (
                  <div
                    key={label}
                    style={{
                      flexShrink: 0,
                      width: barW,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                    }}
                    title={`${label}: ${valueStr} hrs (${d.count} entries)`}
                  >
                    {/* value above bar (when bar too short for inside label) */}
                    {!insideBar && (
                      <span
                        style={{
                          fontSize: 9,
                          color: barColor,
                          fontWeight: 800,
                          marginBottom: 2,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {valueStr}
                      </span>
                    )}
                    {/* bar */}
                    <div
                      style={{
                        width: "100%",
                        height: h,
                        background: barColor,
                        borderRadius: "4px 4px 0 0",
                        position: "relative",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {insideBar && (
                        <span
                          style={{
                            position: "absolute",
                            color: "#fff",
                            fontWeight: 800,
                            fontSize: 10,
                            writingMode: "vertical-rl",
                            transform: "rotate(180deg)",
                            whiteSpace: "nowrap",
                            letterSpacing: 0.5,
                            textShadow: "0 1px 2px rgba(0,0,0,.4)",
                          }}
                        >
                          {valueStr}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* x-axis labels */}
            <div
              style={{
                display: "flex",
                gap: 6,
                paddingTop: 4,
                minWidth: "max-content",
              }}
            >
              {chartData.map((d) => {
                const label = chartLabel(d);
                const barW =
                  chartMode === "monthly"
                    ? 48
                    : chartMode === "weekly"
                      ? 40
                      : 32;
                return (
                  <div
                    key={label}
                    style={{ flexShrink: 0, width: barW, textAlign: "center" }}
                  >
                    <span
                      style={{
                        fontSize: 9,
                        color: "#1e293b",
                        fontWeight: 700,
                        display: "inline-block",
                        transform: "rotate(-35deg)",
                        transformOrigin: "top center",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
