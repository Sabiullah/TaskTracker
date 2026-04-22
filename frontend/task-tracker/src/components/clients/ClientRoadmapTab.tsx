import { useMemo, useState } from "react";
import { useClientRoadmap } from "@/hooks/useClientRoadmap";
import { useMasters } from "@/hooks/useMasters";
import { exportCSV } from "@/utils/csv";
import MultiSelect from "@/components/ui/MultiSelect";
import ClientRoadmapModal from "./ClientRoadmapModal";
import ClientRoadmapFocusModal from "./ClientRoadmapFocusModal";
import { reportApiError } from "./errors";
import type { Profile } from "@/types/auth";
import type {
  ClientRoadmapDto,
  ClientRoadmapWrite,
  Priority,
  RoadmapStatus,
} from "@/types/api/clients";

interface Props {
  /** Page-level selected client. Used as the default-expanded group and the
   *  modal's pre-filled client. Empty string = no default. */
  clientUid: string;
  profiles: Profile[];
  canWrite: boolean;
}

const STATUSES: RoadmapStatus[] = [
  "Not Started",
  "In Progress",
  "Achieved",
  "At Risk",
  "Cancelled",
];
const PRIORITIES: Priority[] = ["High", "Medium", "Low"];

type SortField = "target" | "owner" | "status" | "priority";

const STATUS_ORDER: Record<RoadmapStatus, number> = {
  "Not Started": 1,
  "In Progress": 2,
  "At Risk": 3,
  "Achieved": 4,
  "Cancelled": 5,
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
    diff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
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

export default function ClientRoadmapTab({ clientUid, profiles, canWrite }: Props) {
  // Fetch ALL roadmap items — we group them client-side now.
  const { items, loading, create, update, remove } = useClientRoadmap();
  const { clients } = useMasters();
  const [modalOpen, setModalOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<string[]>([]);
  const [ownerFilter, setOwnerFilter] = useState<string[]>([]);
  const [overdueOnly, setOverdueOnly] = useState(false);
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

  const filtered = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return items.filter((r) => {
      if (statusFilter.length > 0 && !statusFilter.includes(r.status)) return false;
      if (priorityFilter.length > 0 && !priorityFilter.includes(r.priority)) return false;
      if (ownerFilter.length > 0 && !(r.owner && ownerFilter.includes(r.owner))) return false;
      if (overdueOnly) {
        if (r.status === "Achieved" || r.status === "Cancelled") return false;
        const targetPast = r.target_date !== null && r.target_date < today;
        const expectedSlipped =
          r.target_date !== null &&
          r.expected_date !== null &&
          r.expected_date > r.target_date;
        if (!targetPast && !expectedSlipped) return false;
      }
      return true;
    });
  }, [items, statusFilter, priorityFilter, ownerFilter, overdueOnly]);

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
    <div>
      <div
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
        />
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6, paddingBottom: 6 }}>
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(e) => setOverdueOnly(e.target.checked)}
          />
          Overdue only
        </label>
        {canWrite && (
          <button type="button" onClick={() => setModalOpen(true)} style={{ ...btnPrimary, alignSelf: "flex-end" }}>
            + Add roadmap item
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            const rows = filtered.map((r) => ({
              Client: r.client_detail?.name ?? "",
              Title: r.title,
              Owner: r.owner_detail?.full_name ?? "",
              Category: r.category,
              Description: r.description ?? "",
              Target: r.target_date ?? "",
              Expected: r.expected_date ?? "",
              Completion: r.completion_date ?? "",
              Status: r.status,
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

      {loading ? (
        <div>Loading…</div>
      ) : groups.length === 0 ? (
        <div style={{ color: "#64748b" }}>No roadmap items yet.</div>
      ) : (
        groups.map((g) => {
          const isOpen = expanded.has(g.clientUid);
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
                <span style={{ color: "#64748b", fontWeight: 400 }}>
                  ({g.rows.length})
                </span>
              </button>
              {isOpen && (
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
              )}
            </div>
          );
        })
      )}

      <ClientRoadmapModal
        open={modalOpen}
        defaultClientUid={clientUid}
        clients={clients}
        profiles={profiles}
        onClose={() => setModalOpen(false)}
        onSubmit={async (body) => {
          try {
            await create({ ...body, org: clientOrgUidFor(body.client) });
          } catch (err) {
            reportApiError("Save failed", err);
            throw err;
          }
        }}
      />

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

  return (
    <tr style={{ borderBottom: "1px solid #e2e8f0" }}>
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
        {canWrite ? (
          <select
            value={merged.status}
            onChange={(e) => setLocal({ ...local, status: e.target.value as RoadmapStatus })}
            style={cellInput}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ) : (
          merged.status
        )}
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
const btnPrimary: React.CSSProperties = {
  padding: "6px 12px",
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontWeight: 600,
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
