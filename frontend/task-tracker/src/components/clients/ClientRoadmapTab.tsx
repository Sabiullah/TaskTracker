import { useMemo, useState } from "react";
import { useClientRoadmap } from "@/hooks/useClientRoadmap";
import ClientRoadmapModal from "./ClientRoadmapModal";
import type { Profile } from "@/types/auth";
import type {
  ClientRoadmapDto,
  Priority,
  RoadmapStatus,
} from "@/types/api/clients";

interface Props {
  clientUid: string;
  profiles: Profile[];
  canWrite: boolean;
}

const STATUSES: RoadmapStatus[] = ["Not Started", "In Progress", "Achieved", "At Risk", "Cancelled"];
const PRIORITIES: Priority[] = ["High", "Medium", "Low"];

export default function ClientRoadmapTab({ clientUid, profiles, canWrite }: Props) {
  const { items, loading, create, update, remove } = useClientRoadmap(clientUid || undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ClientRoadmapDto | null>(null);
  const [statusFilter, setStatusFilter] = useState<RoadmapStatus | "">("");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "">("");
  const [overdueOnly, setOverdueOnly] = useState(false);

  const filtered = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return items.filter((r) => {
      if (clientUid && r.client !== clientUid) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      if (priorityFilter && r.priority !== priorityFilter) return false;
      if (overdueOnly) {
        if (!r.target_date) return false;
        if (r.status === "Achieved" || r.status === "Cancelled") return false;
        if (r.target_date >= today) return false;
      }
      return true;
    });
  }, [items, clientUid, statusFilter, priorityFilter, overdueOnly]);

  if (!clientUid) {
    return <div style={{ color: "#64748b" }}>Select a client to view their road map.</div>;
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as RoadmapStatus | "")} style={filterStyle}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as Priority | "")} style={filterStyle}>
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
          Overdue only
        </label>
        {canWrite && (
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
            style={btnPrimary}
          >
            + Add roadmap item
          </button>
        )}
      </div>

      {loading ? (
        <div>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ color: "#64748b" }}>No roadmap items yet.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f8fafc", textAlign: "left" }}>
              <th style={thStyle}>Title</th>
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
            {filtered.map((r) => (
              <tr key={r.uid} style={{ borderBottom: "1px solid #e2e8f0" }}>
                <td style={tdStyle}>{r.title}</td>
                <td style={tdStyle}>{r.owner_detail?.full_name ?? "—"}</td>
                <td style={tdStyle}>{r.category || "—"}</td>
                <td style={tdStyle}>{r.target_date ?? "—"}</td>
                <td style={tdStyle}>{r.completion_date ?? "—"}</td>
                <td style={tdStyle}>{r.status}</td>
                <td style={tdStyle}>{r.priority}</td>
                <td style={tdStyle}>{r.progress_notes || "—"}</td>
                {canWrite && (
                  <td style={tdStyle}>
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(r);
                        setModalOpen(true);
                      }}
                      style={btnLink}
                    >
                      Edit
                    </button>
                    {" · "}
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm("Delete this roadmap item?")) void remove(r.uid);
                      }}
                      style={{ ...btnLink, color: "#b91c1c" }}
                    >
                      Delete
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <ClientRoadmapModal
        open={modalOpen}
        clientUid={clientUid}
        existing={editing}
        profiles={profiles}
        onClose={() => setModalOpen(false)}
        onSubmit={async (body) => {
          if (editing) {
            await update(editing.uid, body);
          } else {
            await create(body);
          }
        }}
      />
    </div>
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
const btnLink: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  color: "#2563eb",
  cursor: "pointer",
  fontSize: 13,
};
const thStyle: React.CSSProperties = { padding: "8px 10px", fontWeight: 600, borderBottom: "1px solid #e2e8f0" };
const tdStyle: React.CSSProperties = { padding: "8px 10px", verticalAlign: "top" };
