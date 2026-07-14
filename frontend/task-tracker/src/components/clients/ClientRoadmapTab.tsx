import { useMemo, useState } from "react";
import { useClientRoadmap } from "@/hooks/useClientRoadmap";
import { useMasters } from "@/hooks/useMasters";
import { exportCSV } from "@/utils/csv";
import MultiSelect from "@/components/ui/MultiSelect";
import ClientRoadmapAddRow from "./ClientRoadmapAddRow";
import ClientRoadmapFocusModal from "./ClientRoadmapFocusModal";
import { reportApiError } from "./errors";
import { matchesMonth } from "./monthFilter";
import { deriveRoadmapStatus } from "./roadmapStatus";
import type { Profile } from "@/types/auth";
import type {
  ClientRoadmapDto,
  ClientRoadmapWrite,
  Priority,
  RoadmapStatus,
} from "@/types/api/clients";

interface Props {
  /** Page-level selected client. When set, the tab shows only that client's
   *  rows. Also pre-fills the modal's client picker. Empty string = no
   *  client selected, fall back to org-level grouping. */
  clientUid: string;
  /** Page-level selected org. Used to scope the visible items when no client
   *  is selected. `null` means "ALL" (no org scoping). */
  selectedOrg: string | null;
  profiles: Profile[];
  canWrite: boolean;
}

const STATUSES: RoadmapStatus[] = [
  "Not Started",
  "In Progress",
  "Overdue",
  "Completed",
];
const PRIORITIES: Priority[] = ["High", "Medium", "Low"];

type SortField = "target" | "owner" | "status" | "priority";

const deriveStatus = deriveRoadmapStatus;

const STATUS_ORDER: Record<RoadmapStatus, number> = {
  "Not Started": 1,
  "In Progress": 2,
  "Overdue": 3,
  "Completed": 4,
};
const STATUS_ROW_BG: Record<RoadmapStatus, string> = {
  "Completed": "#dcfce7",    // green-100
  "In Progress": "#dbeafe",  // blue-100
  "Overdue": "#fee2e2",      // red-100
  "Not Started": "#f1f5f9",  // slate-100
};
const STATUS_TEXT: Record<RoadmapStatus, string> = {
  "Completed": "#166534",
  "In Progress": "#1e40af",
  "Overdue": "#991b1b",
  "Not Started": "#475569",
};

const PRIORITY_ORDER: Record<Priority, number> = {
  High: 1,
  Medium: 2,
  Low: 3,
};

function compareRows(
  a: ClientRoadmapDto,
  b: ClientRoadmapDto,
  field: SortField,
  dir: "asc" | "desc",
): number {
  let diff = 0;
  if (field === "target") {
    const av = a.target_date ?? "";
    const bv = b.target_date ?? "";
    diff = av < bv ? -1 : av > bv ? 1 : 0;
  } else if (field === "owner") {
    const av = a.owner_detail?.full_name ?? "";
    const bv = b.owner_detail?.full_name ?? "";
    diff = av.localeCompare(bv);
  } else if (field === "status") {
    diff = STATUS_ORDER[deriveStatus(a)] - STATUS_ORDER[deriveStatus(b)];
  } else if (field === "priority") {
    diff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
  }
  return dir === "asc" ? diff : -diff;
}

function SortableTh({
  field,
  label,
  sortField,
  sortDir,
  onClick,
}: {
  field: SortField;
  label: string;
  sortField: SortField | null;
  sortDir: "asc" | "desc";
  onClick: () => void;
}) {
  const active = sortField === field;
  const arrow = active ? (sortDir === "asc" ? " ▲" : " ▼") : "";
  return (
    <th style={{ ...thStyle, cursor: "pointer", userSelect: "none" }} onClick={onClick}>
      {label}
      {arrow}
    </th>
  );
}

export default function ClientRoadmapTab({ clientUid, selectedOrg, profiles, canWrite }: Props) {
  // Fetch ALL roadmap items — we group them client-side now.
  const { items, loading, create, update, remove } = useClientRoadmap();
  const { clients } = useMasters();
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<string[]>([]);
  const [ownerFilter, setOwnerFilter] = useState<string[]>([]);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [targetMonth, setTargetMonth] = useState<string>("");
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(clientUid ? [clientUid] : []),
  );
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [focusState, setFocusState] = useState<{
    rowUid: string;
    field: "description" | "progress_notes";
    value: string;
  } | null>(null);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  // Items in scope of the page-level client/org selector but NOT the in-tab
  // filters. Used to compute overdue badges that reflect true overdue load
  // regardless of what status/owner/etc. filter is currently applied.
  const scopedItems = useMemo(() => {
    return items.filter((r) => {
      if (clientUid) return r.client === clientUid;
      if (selectedOrg) return r.org_uid === selectedOrg;
      return true;
    });
  }, [items, clientUid, selectedOrg]);

  const overdueCountByOwner = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of scopedItems) {
      if (deriveStatus(r) !== "Overdue") continue;
      if (!r.owner) continue;
      counts[r.owner] = (counts[r.owner] ?? 0) + 1;
    }
    return counts;
  }, [scopedItems]);

  const overdueCountByClient = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of scopedItems) {
      if (deriveStatus(r) !== "Overdue") continue;
      const uid = r.client ?? "unassigned";
      counts.set(uid, (counts.get(uid) ?? 0) + 1);
    }
    return counts;
  }, [scopedItems]);

  const filtered = useMemo(() => {
    return scopedItems.filter((r) => {
      const derived = deriveStatus(r);
      if (statusFilter.length > 0 && !statusFilter.includes(derived)) return false;
      if (priorityFilter.length > 0 && !priorityFilter.includes(r.priority)) return false;
      if (ownerFilter.length > 0 && !(r.owner && ownerFilter.includes(r.owner))) return false;
      if (overdueOnly && derived !== "Overdue") return false;
      if (!matchesMonth(r.target_date, targetMonth)) return false;
      return true;
    });
  }, [scopedItems, statusFilter, priorityFilter, ownerFilter, overdueOnly, targetMonth]);

  // Group by client.uid. Items with no client go into an "unassigned" bucket
  // that renders last.
  const groups = useMemo(() => {
    const byUid = new Map<
      string,
      { clientUid: string; clientName: string; rows: ClientRoadmapDto[] }
    >();
    for (const r of filtered) {
      const uid = r.client ?? "unassigned";
      const name = r.client_detail?.name ?? "(Unassigned)";
      const bucket = byUid.get(uid) ?? {
        clientUid: uid,
        clientName: name,
        rows: [],
      };
      bucket.rows.push(r);
      byUid.set(uid, bucket);
    }
    const arr = Array.from(byUid.values());
    arr.sort((a, b) => {
      // Push unassigned bucket to the bottom.
      if (a.clientUid === "unassigned") return 1;
      if (b.clientUid === "unassigned") return -1;
      return a.clientName.localeCompare(b.clientName);
    });
    if (sortField) {
      for (const g of arr) {
        g.rows = [...g.rows].sort((a, b) => compareRows(a, b, sortField, sortDir));
      }
    }
    return arr;
  }, [filtered, sortField, sortDir]);

  // Multi-org admins need to tell the backend *which* org owns the new
  // roadmap item, otherwise `resolve_create_org` returns 400. Since the
  // modal now picks the client (not the page-level selector), derive the
  // org from the modal's chosen client.
  const clientOrgUidFor = (uid: string | undefined): string | undefined => {
    if (!uid) return undefined;
    const c = clients.find((x) => x.id === uid);
    return c?.org ?? c?.orgs?.[0] ?? undefined;
  };

  const toggle = (uid: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });

  return (
    <div className="cl-roadmap">
      <div
        className="cl-roadmap-filters"
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 10,
          marginBottom: 10,
          flexWrap: "wrap",
        }}
      >
        <MultiSelect
          label="Status"
          options={STATUSES as string[]}
          selected={statusFilter}
          onChange={setStatusFilter}
          allLabel="All statuses"
        />
        <MultiSelect
          label="Priority"
          options={PRIORITIES as string[]}
          selected={priorityFilter}
          onChange={setPriorityFilter}
          allLabel="All priorities"
        />
        <MultiSelect
          label="Owner"
          options={profiles.map((p) => p.id)}
          selected={ownerFilter}
          onChange={setOwnerFilter}
          allLabel="All owners"
          labels={Object.fromEntries(profiles.map((p) => [p.id, p.full_name]))}
          badges={overdueCountByOwner}
        />
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 600, color: "#475569" }}>
          TARGET MONTH
          <input
            type="month"
            value={targetMonth}
            onChange={(e) => setTargetMonth(e.target.value)}
            style={filterStyle}
          />
        </label>
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6, paddingBottom: 6 }}>
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(e) => setOverdueOnly(e.target.checked)}
          />
          Overdue only
        </label>
        <button
          type="button"
          onClick={() => {
            const rows = filtered.map((r) => ({
              Client: r.client_detail?.name ?? "",
              Title: r.title,
              Owner: r.owner_detail?.full_name ?? "",
              Category: r.category,
              Description: r.description ?? "",
              Start: r.start_date ?? "",
              Target: r.target_date ?? "",
              Expected: r.expected_date ?? "",
              Completion: r.completion_date ?? "",
              Status: deriveStatus(r),
              Priority: r.priority,
              Progress: r.progress_notes,
            }));
            if (rows.length === 0) {
              window.alert("Nothing to export with the current filters.");
              return;
            }
            const stamp = new Date().toISOString().slice(0, 10);
            exportCSV(rows, `client-roadmap-${stamp}.csv`);
          }}
          style={{ ...filterStyle, cursor: "pointer", alignSelf: "flex-end" }}
        >
          ⬇ Export CSV
        </button>
      </div>

      {canWrite && (
        <div className="cl-table-wrap">
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 13,
            marginBottom: 10,
            border: "1px solid #e2e8f0",
            borderRadius: 6,
          }}
        >
          <thead>
            <tr style={{ background: "#f1f5f9", textAlign: "left" }}>
              <th style={thStyle}>Client*</th>
              <th style={thStyle}>Title*</th>
              <th style={thStyle}>Owner</th>
              <th style={thStyle}>Category</th>
              <th style={thStyle}>Description</th>
              <th style={thStyle}>Start</th>
              <th style={thStyle}>Target</th>
              <th style={thStyle}>Expected</th>
              <th style={thStyle}>Completion</th>
              <th style={thStyle}>Priority</th>
              <th style={thStyle}>Progress</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            <ClientRoadmapAddRow
              clients={clients}
              profiles={profiles}
              defaultClientUid={clientUid}
              onAdd={async (body) => {
                try {
                  await create({ ...body, org: clientOrgUidFor(body.client) });
                } catch (err) {
                  reportApiError("Save failed", err);
                  throw err;
                }
              }}
            />
          </tbody>
        </table>
        </div>
      )}

      {loading ? (
        <div>Loading…</div>
      ) : groups.length === 0 ? (
        <div style={{ color: "#64748b" }}>No roadmap items yet.</div>
      ) : (
        groups.map((g) => {
          const isOpen = expanded.has(g.clientUid);
          const clientOverdueCount = overdueCountByClient.get(g.clientUid) ?? 0;
          return (
            <div
              key={g.clientUid}
              style={{
                marginBottom: 8,
                border: "1px solid #e2e8f0",
                borderRadius: 6,
                overflow: "hidden",
              }}
            >
              <button
                type="button"
                onClick={() => toggle(g.clientUid)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  background: isOpen ? "#eff6ff" : "#f8fafc",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span style={{ width: 12 }}>{isOpen ? "▾" : "▸"}</span>
                <span>{g.clientName}</span>
                {clientOverdueCount > 0 && (
                  <span
                    aria-label={`${clientOverdueCount} overdue roadmap item${clientOverdueCount === 1 ? "" : "s"}`}
                    title={`${clientOverdueCount} overdue roadmap item${clientOverdueCount === 1 ? "" : "s"}`}
                    style={overdueBadgeStyle}
                  >
                    {clientOverdueCount} overdue
                  </span>
                )}
                <span style={{ color: "#64748b", fontWeight: 400 }}>
                  ({g.rows.length})
                </span>
              </button>
              {isOpen && (
                <div className="cl-table-wrap">
                <table
                  style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
                >
                  <thead>
                    <tr style={{ background: "#fafafa", textAlign: "left" }}>
                      <th style={thStyle}>Title</th>
                      <SortableTh
                        field="owner"
                        label="Owner"
                        sortField={sortField}
                        sortDir={sortDir}
                        onClick={() => toggleSort("owner")}
                      />
                      <th style={thStyle}>Category</th>
                      <th style={thStyle}>Description</th>
                      <th style={thStyle}>Start</th>
                      <SortableTh
                        field="target"
                        label="Target"
                        sortField={sortField}
                        sortDir={sortDir}
                        onClick={() => toggleSort("target")}
                      />
                      <th style={thStyle}>Expected</th>
                      <th style={thStyle}>Completion</th>
                      <SortableTh
                        field="status"
                        label="Status"
                        sortField={sortField}
                        sortDir={sortDir}
                        onClick={() => toggleSort("status")}
                      />
                      <SortableTh
                        field="priority"
                        label="Priority"
                        sortField={sortField}
                        sortDir={sortDir}
                        onClick={() => toggleSort("priority")}
                      />
                      <th style={thStyle}>Progress</th>
                      {canWrite && <th style={thStyle}>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r) => (
                      <Row
                        key={r.uid}
                        r={r}
                        profiles={profiles}
                        canWrite={canWrite}
                        onUpdate={async (body) => {
                          try {
                            await update(r.uid, body);
                          } catch (err) {
                            reportApiError("Save failed", err);
                            throw err;
                          }
                        }}
                        onDelete={() => {
                          if (!window.confirm("Delete this roadmap item?")) return;
                          remove(r.uid).catch((err) =>
                            reportApiError("Delete failed", err),
                          );
                        }}
                        onFocus={
                          canWrite
                            ? (field, value) =>
                                setFocusState({ rowUid: r.uid, field, value })
                            : () => {}
                        }
                      />
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </div>
          );
        })
      )}

      <ClientRoadmapFocusModal
        open={focusState !== null}
        title={focusState?.field === "description" ? "Description" : "Progress notes"}
        initialValue={focusState?.value ?? ""}
        onClose={() => setFocusState(null)}
        onSave={async (value) => {
          if (!focusState) return;
          try {
            await update(focusState.rowUid, { [focusState.field]: value });
          } catch (err) {
            reportApiError("Save failed", err);
            throw err;
          }
        }}
      />
    </div>
  );
}

function Row({
  r,
  profiles,
  canWrite,
  onUpdate,
  onDelete,
  onFocus,
}: {
  r: ClientRoadmapDto;
  profiles: Profile[];
  canWrite: boolean;
  onUpdate: (body: Partial<ClientRoadmapWrite>) => Promise<void>;
  onDelete: () => void;
  onFocus: (field: "description" | "progress_notes", value: string) => void;
}) {
  const [local, setLocal] = useState<Partial<ClientRoadmapWrite>>({});
  // Overlay pending edits on the DTO for display in inputs. Cast is needed
  // because DTO fields are readonly but we're only using this for reads.
  const merged = { ...r, ...local } as ClientRoadmapDto;
  const dirty = Object.keys(local).length > 0;
  const derivedStatus = deriveStatus(merged);

  return (
    <tr
      style={{
        borderBottom: "1px solid #e2e8f0",
        background: STATUS_ROW_BG[derivedStatus],
      }}
    >
      <td style={tdStyle}>
        {canWrite ? (
          <input
            value={merged.title}
            onChange={(e) => setLocal({ ...local, title: e.target.value })}
            style={cellInput}
          />
        ) : (
          merged.title
        )}
      </td>
      <td style={tdStyle}>
        {canWrite ? (
          <select
            value={merged.owner ?? ""}
            onChange={(e) => setLocal({ ...local, owner: e.target.value || null })}
            style={cellInput}
          >
            <option value="">—</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
        ) : (
          r.owner_detail?.full_name ?? "—"
        )}
      </td>
      <td style={tdStyle}>
        {canWrite ? (
          <input
            value={merged.category ?? ""}
            onChange={(e) => setLocal({ ...local, category: e.target.value })}
            style={cellInput}
          />
        ) : (
          merged.category || "—"
        )}
      </td>
      <td style={tdStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {canWrite ? (
            <input
              value={merged.description ?? ""}
              onChange={(e) => setLocal({ ...local, description: e.target.value })}
              style={{ ...cellInput, flex: 1 }}
            />
          ) : (
            <span
              style={{
                maxWidth: 220,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                display: "inline-block",
              }}
            >
              {merged.description || "—"}
            </span>
          )}
          {canWrite && (
            <button
              type="button"
              onClick={() => onFocus("description", merged.description ?? "")}
              title="Expand"
              style={{
                background: "none",
                border: "none",
                color: "#64748b",
                cursor: "pointer",
                padding: "0 4px",
                fontSize: 14,
              }}
            >
              ⤢
            </button>
          )}
        </div>
      </td>
      <td style={tdStyle}>
        {canWrite ? (
          <input
            type="date"
            value={merged.start_date ?? ""}
            onChange={(e) => setLocal({ ...local, start_date: e.target.value || null })}
            style={cellInput}
          />
        ) : (
          merged.start_date ?? "—"
        )}
      </td>
      <td style={tdStyle}>
        {canWrite ? (
          <input
            type="date"
            value={merged.target_date ?? ""}
            onChange={(e) => setLocal({ ...local, target_date: e.target.value || null })}
            style={cellInput}
          />
        ) : (
          merged.target_date ?? "—"
        )}
      </td>
      <td style={tdStyle}>
        {canWrite ? (
          <input
            type="date"
            value={merged.expected_date ?? ""}
            onChange={(e) => setLocal({ ...local, expected_date: e.target.value || null })}
            style={cellInput}
          />
        ) : (
          merged.expected_date ?? "—"
        )}
      </td>
      <td style={tdStyle}>
        {canWrite ? (
          <input
            type="date"
            value={merged.completion_date ?? ""}
            onChange={(e) =>
              setLocal({ ...local, completion_date: e.target.value || null })
            }
            style={cellInput}
          />
        ) : (
          merged.completion_date ?? "—"
        )}
      </td>
      <td style={tdStyle}>
        <span
          title="Status is derived from the date fields and cannot be edited directly"
          style={{
            display: "inline-block",
            padding: "2px 8px",
            borderRadius: 999,
            background: STATUS_ROW_BG[derivedStatus],
            color: STATUS_TEXT[derivedStatus],
            border: `1px solid ${STATUS_TEXT[derivedStatus]}33`,
            fontWeight: 600,
            fontSize: 12,
          }}
        >
          {derivedStatus}
        </span>
      </td>
      <td style={tdStyle}>
        {canWrite ? (
          <select
            value={merged.priority}
            onChange={(e) => setLocal({ ...local, priority: e.target.value as Priority })}
            style={cellInput}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        ) : (
          merged.priority
        )}
      </td>
      <td style={tdStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {canWrite ? (
            <input
              value={merged.progress_notes ?? ""}
              onChange={(e) => setLocal({ ...local, progress_notes: e.target.value })}
              style={{ ...cellInput, flex: 1 }}
            />
          ) : (
            <span
              style={{
                maxWidth: 220,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                display: "inline-block",
              }}
            >
              {merged.progress_notes || "—"}
            </span>
          )}
          {canWrite && (
            <button
              type="button"
              onClick={() => onFocus("progress_notes", merged.progress_notes ?? "")}
              title="Expand"
              style={{
                background: "none",
                border: "none",
                color: "#64748b",
                cursor: "pointer",
                padding: "0 4px",
                fontSize: 14,
              }}
            >
              ⤢
            </button>
          )}
        </div>
      </td>
      {canWrite && (
        <td style={tdStyle}>
          {dirty && (
            <button
              type="button"
              onClick={async () => {
                await onUpdate(local);
                setLocal({});
              }}
              style={btnSmall}
            >
              Save
            </button>
          )}{" "}
          <button
            type="button"
            onClick={onDelete}
            style={{ ...btnSmall, background: "#fee2e2", color: "#b91c1c" }}
          >
            ×
          </button>
        </td>
      )}
    </tr>
  );
}

const filterStyle: React.CSSProperties = {
  padding: "6px 8px",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  fontSize: 13,
};
const thStyle: React.CSSProperties = {
  padding: "8px 10px",
  fontWeight: 600,
  borderBottom: "1px solid #e2e8f0",
};
const tdStyle: React.CSSProperties = { padding: "8px 10px", verticalAlign: "top" };
const cellInput: React.CSSProperties = {
  width: "100%",
  padding: "4px 6px",
  border: "1px solid transparent",
  borderRadius: 4,
  fontSize: 13,
  background: "transparent",
};
const btnSmall: React.CSSProperties = {
  padding: "4px 8px",
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
};
const overdueBadgeStyle: React.CSSProperties = {
  background: "#dc2626",
  color: "#fff",
  padding: "1px 8px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1.4,
};
