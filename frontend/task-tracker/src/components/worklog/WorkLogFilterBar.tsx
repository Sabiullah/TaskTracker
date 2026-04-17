import type { ChangeEvent, CSSProperties, RefObject } from "react";
import { fromMins } from "@/utils/time";
import { exportCSV } from "@/utils/worklog";

interface WorkLogFilterBarProps {
  selectedOrg: string;
  isAdmin: boolean;
  isManager: boolean;
  logMembers: string[];
  logClients: string[];
  logMonths: string[];
  fMember: string;
  fClient: string;
  fDate: string;
  fMonth: string;
  sortBy: string;
  sortDir: string;
  totalMins: number;
  filteredCount: number;
  filtered: unknown[];
  editRowsCount: number;
  selectedCount: number;
  backdateDays: number;
  backdateLoaded: boolean;
  fileRef: RefObject<HTMLInputElement | null>;
  onMemberChange: (v: string) => void;
  onClientChange: (v: string) => void;
  onDateChange: (v: string) => void;
  onMonthChange: (v: string) => void;
  onClearFilters: () => void;
  onClearSort: () => void;
  onSaveAll: () => void;
  onBulkDelete: () => void;
  onImport: (e: ChangeEvent<HTMLInputElement>) => void;
  onAddRow: () => void;
  onSaveBackdate: (n: number) => Promise<void>;
}

const selStyle: CSSProperties = {
  padding: "6px 10px",
  border: "1.5px solid #e2e8f0",
  borderRadius: 6,
  fontSize: 13,
  background: "#fff",
  cursor: "pointer",
};

export default function WorkLogFilterBar({
  selectedOrg,
  isAdmin,
  isManager,
  logMembers,
  logClients,
  logMonths,
  fMember,
  fClient,
  fDate,
  fMonth,
  sortBy,
  sortDir,
  totalMins,
  filteredCount,
  filtered,
  editRowsCount,
  selectedCount,
  backdateDays,
  backdateLoaded,
  fileRef,
  onMemberChange,
  onClientChange,
  onDateChange,
  onMonthChange,
  onClearFilters,
  onClearSort,
  onSaveAll,
  onBulkDelete,
  onImport,
  onAddRow,
  onSaveBackdate,
}: WorkLogFilterBarProps) {
  return (
    <div
      className="wl-filter-bar"
      style={{
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        marginBottom: 12,
        padding: "10px 12px",
        background: "#f8fafc",
        borderRadius: 8,
        alignItems: "flex-end",
      }}
    >
      {selectedOrg && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            background: "#eff6ff",
            border: "1px solid #bfdbfe",
            borderRadius: 16,
            fontSize: 12,
            fontWeight: 700,
            color: "#2563eb",
            alignSelf: "center",
          }}
        >
          🏢 {selectedOrg}
          <span style={{ fontSize: 10, fontWeight: 400, color: "#64748b" }}>
            org filter active
          </span>
        </div>
      )}
      {(isAdmin || isManager) && (
        <div>
          <div
            className="wl-filter-label"
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#64748b",
              marginBottom: 3,
            }}
          >
            MEMBER
          </div>
          <select
            value={fMember}
            onChange={(e) => onMemberChange(e.target.value)}
            style={selStyle}
          >
            <option value="">All Members</option>
            {logMembers.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <div
          className="wl-filter-label"
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#64748b",
            marginBottom: 3,
          }}
        >
          CLIENT
        </div>
        <select
          value={fClient}
          onChange={(e) => onClientChange(e.target.value)}
          style={selStyle}
        >
          <option value="">All Clients</option>
          {logClients.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div>
        <div
          className="wl-filter-label"
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#64748b",
            marginBottom: 3,
          }}
        >
          MONTH
        </div>
        <select
          value={fMonth}
          onChange={(e) => onMonthChange(e.target.value)}
          style={selStyle}
        >
          <option value="">All Months</option>
          {logMonths.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
      <div>
        <div
          className="wl-filter-label"
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#64748b",
            marginBottom: 3,
          }}
        >
          DATE
        </div>
        <input
          type="date"
          value={fDate}
          onChange={(e) => onDateChange(e.target.value)}
          style={{ ...selStyle, minWidth: 140 }}
        />
      </div>
      {(fMember || fClient || fDate || fMonth) && (
        <button
          onClick={onClearFilters}
          style={{
            padding: "6px 10px",
            border: "1px solid #e2e8f0",
            background: "#fff",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          ✕ Clear Filters
        </button>
      )}
      {sortBy && (
        <button
          onClick={onClearSort}
          style={{
            padding: "6px 10px",
            border: "1px solid #bfdbfe",
            background: "#eff6ff",
            color: "#2563eb",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          ✕ Clear Sort ({sortBy} {sortDir === "asc" ? "▲" : "▼"})
        </button>
      )}
      <div
        style={{
          marginLeft: "auto",
          display: "flex",
          gap: 6,
          alignItems: "flex-end",
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            fontSize: 13,
            color: "#475569",
            fontWeight: 600,
            paddingBottom: 6,
          }}
        >
          {filteredCount} entries ·{" "}
          <span style={{ color: "#2563eb" }}>{fromMins(totalMins)} hrs</span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            background: "#fef9c3",
            border: "1px solid #fde68a",
            borderRadius: 16,
            fontSize: 11,
            fontWeight: 700,
            color: "#92400e",
          }}
          title="How far back non-admin users can log or edit entries"
        >
          ⏳ Backdate:
          {isAdmin ? (
            <select
              value={backdateDays}
              disabled={!backdateLoaded}
              onChange={(e) => {
                void onSaveBackdate(parseInt(e.target.value, 10));
              }}
              style={{
                padding: "2px 6px",
                border: "1px solid #fde68a",
                borderRadius: 4,
                background: "#fff",
                fontSize: 11,
                fontWeight: 700,
                color: "#92400e",
                cursor: "pointer",
              }}
            >
              <option value={0}>Today only</option>
              <option value={1}>1 day</option>
              <option value={2}>2 days</option>
              <option value={3}>3 days</option>
              <option value={7}>1 week</option>
              <option value={14}>2 weeks</option>
              <option value={30}>1 month</option>
              <option value={60}>2 months</option>
              <option value={90}>3 months</option>
              <option value={-1}>No limit</option>
            </select>
          ) : (
            <span style={{ fontWeight: 700 }}>
              {backdateDays === -1
                ? "No limit"
                : backdateDays === 0
                  ? "Today only"
                  : backdateDays === 1
                    ? "1 day"
                    : `${backdateDays} days`}
            </span>
          )}
        </div>
        {editRowsCount > 1 && (
          <button
            onClick={onSaveAll}
            style={{
              padding: "6px 14px",
              background: "#16a34a",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontWeight: 700,
              fontSize: 12,
            }}
          >
            ✓ Save All ({editRowsCount})
          </button>
        )}
        {selectedCount > 0 && (
          <button
            onClick={onBulkDelete}
            style={{
              padding: "6px 12px",
              background: "#dc2626",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: "pointer",
              fontWeight: 700,
              fontSize: 12,
            }}
          >
            🗑 Delete Selected ({selectedCount})
          </button>
        )}
        {(isAdmin || isManager) && (
          <>
            <button
              onClick={() => fileRef.current?.click()}
              style={{
                padding: "6px 12px",
                background: "#7c3aed",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 12,
              }}
            >
              ⬆ Import CSV
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              onChange={onImport}
              style={{ display: "none" }}
            />
          </>
        )}
        <button
          onClick={() => exportCSV(filtered as Record<string, unknown>[])}
          style={{
            padding: "6px 12px",
            background: "#16a34a",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            fontWeight: 600,
            fontSize: 12,
          }}
        >
          ⬇ Export CSV
        </button>
        <button
          onClick={onAddRow}
          style={{
            padding: "6px 14px",
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            fontWeight: 700,
            fontSize: 13,
          }}
        >
          + Add Row
        </button>
      </div>
    </div>
  );
}
