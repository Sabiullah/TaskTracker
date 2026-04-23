import type { ListFilters } from "@/utils/conveyanceApi";

interface ConveyanceFiltersProps {
  value: ListFilters;
  onChange: (next: ListFilters) => void;
  canFilterByEmployee: boolean;
  employeeOptions: { uid: string; label: string }[];
  clientOptions: { uid: string; label: string }[];
}

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

  return (
    <div
      className="flex gap-2 flex-wrap"
      style={{ marginBottom: 12, display: "flex", gap: 8, flexWrap: "wrap" }}
    >
      {canFilterByEmployee && (
        <select
          value={value.employee_uid ?? ""}
          onChange={(e) => update("employee_uid", e.target.value)}
          aria-label="Filter by employee"
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
      />
      <select
        value={value.status ?? ""}
        onChange={(e) => update("status", e.target.value as ListFilters["status"] | "")}
        aria-label="Filter by status"
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
      />
      {Object.keys(value).length > 0 && (
        <button type="button" onClick={() => onChange({})}>
          Clear
        </button>
      )}
    </div>
  );
}
