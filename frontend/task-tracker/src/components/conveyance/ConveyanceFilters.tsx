import type { CSSProperties } from "react";

import type { ListFilters } from "@/utils/conveyanceApi";

interface ConveyanceFiltersProps {
  value: ListFilters;
  onChange: (next: ListFilters) => void;
  canFilterByEmployee: boolean;
  employeeOptions: { uid: string; label: string }[];
  clientOptions: { uid: string; label: string }[];
}

// The app's global ``input { width: 100% }`` rule (index.css) would
// force every control to fill the row. Scope explicit widths on each
// control here so the bar lays out in a single horizontal row, matching
// how the Leads / Invoice / Notice tabs render their filters.
const rowStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  alignItems: "center",
  marginBottom: 12,
};

const controlStyle: CSSProperties = {
  width: "auto",
  minWidth: 140,
  maxWidth: 200,
  flex: "0 0 auto",
};

const searchStyle: CSSProperties = {
  ...controlStyle,
  minWidth: 180,
  maxWidth: 260,
  flex: "1 1 180px",
};

const monthStyle: CSSProperties = {
  ...controlStyle,
  minWidth: 150,
  maxWidth: 170,
};

const clearBtnStyle: CSSProperties = {
  padding: "6px 14px",
  border: "1px solid #d1d5db",
  background: "#f9fafb",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 13,
  width: "auto",
  flex: "0 0 auto",
};

export default function ConveyanceFilters({
  value,
  onChange,
  canFilterByEmployee,
  employeeOptions,
  clientOptions,
}: ConveyanceFiltersProps) {
  function update<K extends keyof ListFilters>(key: K, v: ListFilters[K] | "") {
    const next: ListFilters = { ...value };
    if (v === "" || v === undefined || v === null) {
      delete next[key];
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      next[key] = v as any;
    }
    onChange(next);
  }

  const hasActiveFilters = Object.keys(value).length > 0;

  return (
    <div style={rowStyle}>
      {canFilterByEmployee && (
        <select
          value={value.employee_uid ?? ""}
          onChange={(e) => update("employee_uid", e.target.value)}
          aria-label="Filter by employee"
          style={controlStyle}
        >
          <option value="">All Employees</option>
          {employeeOptions.map((o) => (
            <option key={o.uid} value={o.uid}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      <select
        value={value.client_uid ?? ""}
        onChange={(e) => update("client_uid", e.target.value)}
        aria-label="Filter by client"
        style={controlStyle}
      >
        <option value="">All Clients</option>
        {clientOptions.map((o) => (
          <option key={o.uid} value={o.uid}>
            {o.label}
          </option>
        ))}
      </select>
      <input
        type="month"
        value={value.month ?? ""}
        onChange={(e) => update("month", e.target.value)}
        aria-label="Filter by month"
        style={monthStyle}
      />
      <select
        value={value.status ?? ""}
        onChange={(e) => update("status", e.target.value as ListFilters["status"] | "")}
        aria-label="Filter by status"
        style={controlStyle}
      >
        <option value="">All Statuses</option>
        <option value="pending">Pending</option>
        <option value="approved">Approved</option>
        <option value="rejected">Rejected</option>
      </select>
      <select
        value={value.claimable ?? ""}
        onChange={(e) =>
          update("claimable", e.target.value as ListFilters["claimable"] | "")
        }
        aria-label="Filter by claimable"
        style={controlStyle}
      >
        <option value="">Claimable: All</option>
        <option value="true">Claimable: Yes</option>
        <option value="false">Claimable: No</option>
      </select>
      <input
        type="search"
        value={value.search ?? ""}
        onChange={(e) => update("search", e.target.value)}
        placeholder="Search reason…"
        aria-label="Search reason"
        style={searchStyle}
      />
      {hasActiveFilters && (
        <button type="button" onClick={() => onChange({})} style={clearBtnStyle}>
          Clear
        </button>
      )}
    </div>
  );
}
