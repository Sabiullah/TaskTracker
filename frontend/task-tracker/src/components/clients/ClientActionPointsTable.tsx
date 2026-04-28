import { Fragment, useState } from "react";
import ClientMeetingAttachments from "./ClientMeetingAttachments";
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
  onUploadAttachment: (apUid: string, file: File) => Promise<void>;
  onDeleteAttachment: (apUid: string, attachmentUid: string) => Promise<void>;
}

const STATUSES: ActionPointStatus[] = ["Open", "In Progress", "Completed", "Cancelled"];
const PRIORITIES: Priority[] = ["High", "Medium", "Low"];

export default function ClientActionPointsTable({
  meetingUid,
  actionPoints,
  profiles,
  roadmapItems: _roadmapItems, // kept for caller compatibility; UI no longer renders linked roadmap
  canWrite,
  onAdd,
  onUpdate,
  onDelete,
  onUploadAttachment,
  onDeleteAttachment,
}: Props) {
  const [draft, setDraft] = useState<ClientActionPointWrite>({ description: "" });
  const [adding, setAdding] = useState(false);
  const [expandedAttachments, setExpandedAttachments] = useState<Set<string>>(new Set());
  const [expandedDesc, setExpandedDesc] = useState<Set<string>>(new Set());

  const toggleAttachments = (uid: string): void =>
    setExpandedAttachments((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });

  const toggleDesc = (uid: string): void =>
    setExpandedDesc((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });

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

  // The action-row + attachments-row pair must span the same column count, so
  // recompute it whenever Attachments / Actions visibility changes. Always
  // visible: 8 base cells + Attachments (1) + Actions when canWrite (1).
  const colCount = 8 + (canWrite ? 1 : 0);

  const today = new Date().toISOString().slice(0, 10);

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
            <th style={thStyle}>Remarks</th>
            <th style={thStyle}>Files</th>
            {canWrite && <th style={thStyle}></th>}
          </tr>
        </thead>
        <tbody>
          {actionPoints.map((ap) => {
            const open = expandedAttachments.has(ap.uid);
            return (
              <Fragment key={ap.uid}>
                <Row
                  ap={ap}
                  profiles={profiles}
                  roadmapItems={_roadmapItems}
                  canWrite={canWrite}
                  attachmentsOpen={open}
                  onToggleAttachments={() => toggleAttachments(ap.uid)}
                  descExpanded={expandedDesc.has(ap.uid)}
                  onToggleDesc={() => toggleDesc(ap.uid)}
                  today={today}
                  onUpdate={onUpdate}
                  onDelete={onDelete}
                />
                {open && (
                  <tr style={{ background: "#f8fafc" }}>
                    <td colSpan={colCount} style={{ padding: "8px 12px" }}>
                      <ClientMeetingAttachments
                        attachments={ap.attachments}
                        canWrite={canWrite}
                        onUpload={(f) => onUploadAttachment(ap.uid, f)}
                        onDelete={(uid) => onDeleteAttachment(ap.uid, uid)}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
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
                <input
                  value={draft.remarks ?? ""}
                  onChange={(e) => setDraft({ ...draft, remarks: e.target.value })}
                  style={cellInput}
                />
              </td>
              <td style={tdStyle}>
                <span style={{ color: "#94a3b8", fontSize: 12 }}>—</span>
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
  roadmapItems: _roadmapItems,
  canWrite,
  attachmentsOpen,
  onToggleAttachments,
  descExpanded,
  onToggleDesc,
  today,
  onUpdate,
  onDelete,
}: {
  ap: ClientActionPointDto;
  profiles: Profile[];
  roadmapItems: readonly ClientRoadmapDto[];
  canWrite: boolean;
  attachmentsOpen: boolean;
  onToggleAttachments: () => void;
  descExpanded: boolean;
  onToggleDesc: () => void;
  today: string;
  onUpdate: (apUid: string, body: Partial<ClientActionPointWrite>) => Promise<void>;
  onDelete: (apUid: string) => Promise<void>;
}) {
  const [local, setLocal] = useState<Partial<ClientActionPointWrite>>({});
  const merged: ClientActionPointDto = { ...ap, ...local };
  const dirty = Object.keys(local).length > 0;

  return (
    <tr
      style={{
        borderBottom: "1px solid #e2e8f0",
        background: rowBackground(ap, today),
        color: ap.status === "Cancelled" ? "#64748b" : undefined,
      }}
    >
      <td style={tdStyle}>
        <div style={{ display: "flex", gap: 4, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {canWrite ? (
              descExpanded ? (
                <textarea
                  rows={4}
                  value={merged.description}
                  onChange={(e) => setLocal({ ...local, description: e.target.value })}
                  style={{ ...cellInput, resize: "vertical", fontFamily: "inherit" }}
                />
              ) : (
                <input
                  value={merged.description}
                  onChange={(e) => setLocal({ ...local, description: e.target.value })}
                  style={cellInput}
                />
              )
            ) : descExpanded ? (
              <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{merged.description}</div>
            ) : (
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{merged.description}</div>
            )}
          </div>
          <button
            type="button"
            onClick={onToggleDesc}
            title={descExpanded ? "Collapse description" : "Expand description"}
            aria-label={descExpanded ? "Collapse description" : "Expand description"}
            style={{
              background: "transparent",
              border: "1px solid #e2e8f0",
              borderRadius: 4,
              padding: "0 6px",
              fontSize: 12,
              cursor: "pointer",
              color: "#64748b",
              lineHeight: "20px",
            }}
          >
            ⤢
          </button>
        </div>
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
          <input value={merged.remarks ?? ""} onChange={(e) => setLocal({ ...local, remarks: e.target.value })} style={cellInput} />
        ) : (
          merged.remarks || "—"
        )}
      </td>
      <td style={tdStyle}>
        <button
          type="button"
          onClick={onToggleAttachments}
          title={attachmentsOpen ? "Hide files" : "Show / add files"}
          style={{
            background: attachmentsOpen ? "#eff6ff" : "transparent",
            border: `1px solid ${attachmentsOpen ? "#bfdbfe" : "#e2e8f0"}`,
            borderRadius: 4,
            padding: "2px 8px",
            fontSize: 12,
            cursor: "pointer",
            color: ap.attachments.length > 0 ? "#1d4ed8" : "#64748b",
            fontWeight: ap.attachments.length > 0 ? 600 : 400,
          }}
        >
          📎 {ap.attachments.length}
        </button>
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

function rowBackground(ap: ClientActionPointDto, today: string): string {
  switch (ap.status) {
    case "Cancelled":
      return "#f1f5f9";
    case "Completed":
      return "#dcfce7";
    case "In Progress":
      return "#dbeafe";
    case "Open":
      if (ap.target_date && ap.target_date < today) return "#fecaca";
      return "#fef3c7";
  }
}
