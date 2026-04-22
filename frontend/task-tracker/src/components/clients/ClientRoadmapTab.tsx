import { useMemo, useState } from "react";
import { useClientRoadmap } from "@/hooks/useClientRoadmap";
import { useMasters } from "@/hooks/useMasters";
import ClientRoadmapModal from "./ClientRoadmapModal";
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

export default function ClientRoadmapTab({ clientUid, profiles, canWrite }: Props) {
  // Fetch ALL roadmap items — we group them client-side now.
  const { items, loading, create, update, remove } = useClientRoadmap();
  const { clients } = useMasters();
  const [modalOpen, setModalOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<RoadmapStatus | "">("");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "">("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(clientUid ? [clientUid] : []),
  );

  const filtered = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return items.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (priorityFilter && r.priority !== priorityFilter) return false;
      if (overdueOnly) {
        if (!r.target_date) return false;
        if (r.status === "Achieved" || r.status === "Cancelled") return false;
        if (r.target_date >= today) return false;
      }
      return true;
    });
  }, [items, statusFilter, priorityFilter, overdueOnly]);

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
    return arr;
  }, [filtered]);

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
          alignItems: "center",
          gap: 10,
          marginBottom: 10,
          flexWrap: "wrap",
        }}
      >
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as RoadmapStatus | "")}
          style={filterStyle}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value as Priority | "")}
          style={filterStyle}
        >
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(e) => setOverdueOnly(e.target.checked)}
          />
          Overdue only
        </label>
        {canWrite && (
          <button type="button" onClick={() => setModalOpen(true)} style={btnPrimary}>
            + Add roadmap item
          </button>
        )}
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
                      <th style={thStyle}>Client</th>
                      <th style={thStyle}>Owner</th>
                      <th style={thStyle}>Category</th>
                      <th style={thStyle}>Target</th>
                      <th style={thStyle}>Completion</th>
                      <th style={thStyle}>Status</th>
                      <th style={thStyle}>Priority</th>
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
    </div>
  );
}

function Row({
  r,
  profiles,
  canWrite,
  onUpdate,
  onDelete,
}: {
  r: ClientRoadmapDto;
  profiles: Profile[];
  canWrite: boolean;
  onUpdate: (body: Partial<ClientRoadmapWrite>) => Promise<void>;
  onDelete: () => void;
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
      <td style={tdStyle}>{r.client_detail?.name ?? "—"}</td>
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
        {canWrite ? (
          <input
            value={merged.progress_notes ?? ""}
            onChange={(e) => setLocal({ ...local, progress_notes: e.target.value })}
            style={cellInput}
          />
        ) : (
          merged.progress_notes || "—"
        )}
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
