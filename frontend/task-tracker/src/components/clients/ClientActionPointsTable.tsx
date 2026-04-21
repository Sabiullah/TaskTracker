import { useState } from "react";
import type { Profile } from "@/types/auth";
import type {
  ActionPointStatus,
  ClientActionPointDto,
  ClientActionPointWrite,
  ClientRoadmapDto,
  Priority,
} from "@/types/api/clients";

interface Props {
  meetingUid: string;
  actionPoints: readonly ClientActionPointDto[];
  profiles: Profile[];
  roadmapItems: readonly ClientRoadmapDto[];
  canWrite: boolean;
  onAdd: (meetingUid: string, body: ClientActionPointWrite) => Promise<void>;
  onUpdate: (apUid: string, body: Partial<ClientActionPointWrite>) => Promise<void>;
  onDelete: (apUid: string) => Promise<void>;
}

const STATUSES: ActionPointStatus[] = ["Open", "In Progress", "Completed", "Cancelled"];
const PRIORITIES: Priority[] = ["High", "Medium", "Low"];

export default function ClientActionPointsTable({
  meetingUid,
  actionPoints,
  profiles,
  roadmapItems,
  canWrite,
  onAdd,
  onUpdate,
  onDelete,
}: Props) {
  const [draft, setDraft] = useState<ClientActionPointWrite>({ description: "" });
  const [adding, setAdding] = useState(false);

  const submitDraft = async () => {
    if (!draft.description.trim()) return;
    setAdding(true);
    try {
      await onAdd(meetingUid, draft);
      setDraft({ description: "" });
    } finally {
      setAdding(false);
    }
  };

  return (
    <div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "#f8fafc", textAlign: "left" }}>
            <th style={thStyle}>Description</th>
            <th style={thStyle}>Responsibility</th>
            <th style={thStyle}>Target</th>
            <th style={thStyle}>Completion</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Priority</th>
            <th style={thStyle}>Linked roadmap</th>
            <th style={thStyle}>Remarks</th>
            {canWrite && <th style={thStyle}></th>}
          </tr>
        </thead>
        <tbody>
          {actionPoints.map((ap) => (
            <Row
              key={ap.uid}
              ap={ap}
              profiles={profiles}
              roadmapItems={roadmapItems}
              canWrite={canWrite}
              onUpdate={onUpdate}
              onDelete={onDelete}
            />
          ))}
          {canWrite && (
            <tr style={{ background: "#fafafa" }}>
              <td style={tdStyle}>
                <input
                  placeholder="New action point…"
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  style={cellInput}
                />
              </td>
              <td style={tdStyle}>
                <select
                  value={draft.responsibility ?? ""}
                  onChange={(e) => setDraft({ ...draft, responsibility: e.target.value || null })}
                  style={cellInput}
                >
                  <option value="">—</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name}
                    </option>
                  ))}
                </select>
              </td>
              <td style={tdStyle}>
                <input
                  type="date"
                  value={draft.target_date ?? ""}
                  onChange={(e) => setDraft({ ...draft, target_date: e.target.value || null })}
                  style={cellInput}
                />
              </td>
              <td style={tdStyle}>
                <input
                  type="date"
                  value={draft.completion_date ?? ""}
                  onChange={(e) => setDraft({ ...draft, completion_date: e.target.value || null })}
                  style={cellInput}
                />
              </td>
              <td style={tdStyle}>
                <select
                  value={draft.status ?? "Open"}
                  onChange={(e) => setDraft({ ...draft, status: e.target.value as ActionPointStatus })}
                  style={cellInput}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </td>
              <td style={tdStyle}>
                <select
                  value={draft.priority ?? "Medium"}
                  onChange={(e) => setDraft({ ...draft, priority: e.target.value as Priority })}
                  style={cellInput}
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </td>
              <td style={tdStyle}>
                <select
                  value={draft.roadmap_link ?? ""}
                  onChange={(e) => setDraft({ ...draft, roadmap_link: e.target.value || null })}
                  style={cellInput}
                >
                  <option value="">—</option>
                  {roadmapItems.map((r) => (
                    <option key={r.uid} value={r.uid}>
                      {r.title}
                    </option>
                  ))}
                </select>
              </td>
              <td style={tdStyle}>
                <input
                  value={draft.remarks ?? ""}
                  onChange={(e) => setDraft({ ...draft, remarks: e.target.value })}
                  style={cellInput}
                />
              </td>
              <td style={tdStyle}>
                <button type="button" onClick={submitDraft} disabled={adding || !draft.description.trim()} style={btnSmall}>
                  Add
                </button>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Row({
  ap,
  profiles,
  roadmapItems,
  canWrite,
  onUpdate,
  onDelete,
}: {
  ap: ClientActionPointDto;
  profiles: Profile[];
  roadmapItems: readonly ClientRoadmapDto[];
  canWrite: boolean;
  onUpdate: (apUid: string, body: Partial<ClientActionPointWrite>) => Promise<void>;
  onDelete: (apUid: string) => Promise<void>;
}) {
  const [local, setLocal] = useState<Partial<ClientActionPointWrite>>({});
  const merged: ClientActionPointDto = {
    ...ap,
    ...local,
    roadmap_link: local.roadmap_link ?? ap.roadmap_link,
  };
  const dirty = Object.keys(local).length > 0;

  return (
    <tr style={{ borderBottom: "1px solid #e2e8f0" }}>
      <td style={tdStyle}>
        {canWrite ? (
          <input value={merged.description} onChange={(e) => setLocal({ ...local, description: e.target.value })} style={cellInput} />
        ) : (
          merged.description
        )}
      </td>
      <td style={tdStyle}>
        {canWrite ? (
          <select
            value={merged.responsibility ?? ""}
            onChange={(e) => setLocal({ ...local, responsibility: e.target.value || null })}
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
          ap.responsibility_detail?.full_name ?? "—"
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
            onChange={(e) => setLocal({ ...local, completion_date: e.target.value || null })}
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
            onChange={(e) => setLocal({ ...local, status: e.target.value as ActionPointStatus })}
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
          <select
            value={merged.roadmap_link ?? ""}
            onChange={(e) => setLocal({ ...local, roadmap_link: e.target.value || null })}
            style={cellInput}
          >
            <option value="">—</option>
            {roadmapItems.map((r) => (
              <option key={r.uid} value={r.uid}>
                {r.title}
              </option>
            ))}
          </select>
        ) : (
          roadmapItems.find((r) => r.uid === merged.roadmap_link)?.title ?? "—"
        )}
      </td>
      <td style={tdStyle}>
        {canWrite ? (
          <input value={merged.remarks ?? ""} onChange={(e) => setLocal({ ...local, remarks: e.target.value })} style={cellInput} />
        ) : (
          merged.remarks || "—"
        )}
      </td>
      {canWrite && (
        <td style={tdStyle}>
          {dirty && (
            <button
              type="button"
              onClick={async () => {
                await onUpdate(ap.uid, local);
                setLocal({});
              }}
              style={btnSmall}
            >
              Save
            </button>
          )}{" "}
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Delete this action point?")) void onDelete(ap.uid);
            }}
            style={{ ...btnSmall, background: "#fee2e2", color: "#b91c1c" }}
          >
            ×
          </button>
        </td>
      )}
    </tr>
  );
}

const cellInput: React.CSSProperties = {
  width: "100%",
  padding: "4px 6px",
  border: "1px solid transparent",
  borderRadius: 4,
  fontSize: 13,
  background: "transparent",
};
const thStyle: React.CSSProperties = { padding: "6px 8px", fontWeight: 600, borderBottom: "1px solid #e2e8f0" };
const tdStyle: React.CSSProperties = { padding: "4px 6px", verticalAlign: "top" };
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
