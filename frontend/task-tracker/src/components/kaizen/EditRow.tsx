import type { CSSProperties, Dispatch, SetStateAction } from "react";
import { tdS as sharedTdS, inpS } from "@/utils/tableStyles";
import type { KaizenRow } from "@/types/kaizen";
import type { MasterItem } from "@/types";

const tdS: CSSProperties = { ...sharedTdS, verticalAlign: "top" };

export interface OrgOption {
  uid: string;
  name: string;
}

export interface KaizenEditRowProps {
  form: KaizenRow;
  setForm: Dispatch<SetStateAction<KaizenRow>>;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  isNew: boolean;
  /** Read-only display string for the Raised-By cell. On new rows this is the
   *  current user's name (the backend will set the FK). On edits it's the
   *  original raiser. */
  raisedByDisplay: string;
  /** Read-only display string for Entry Date. ``YYYY-MM-DD``. */
  entryDateDisplay: string;
  clients: MasterItem[];
  orgOptions?: OrgOption[];
  orgUid?: string;
  setOrgUid?: (uid: string) => void;
}

export default function KaizenEditRow({
  form,
  setForm,
  onSave,
  onCancel,
  saving,
  isNew,
  raisedByDisplay,
  entryDateDisplay,
  clients,
  orgOptions = [],
  orgUid = "",
  setOrgUid,
}: KaizenEditRowProps) {
  const showOrgPicker = isNew && orgOptions.length > 1 && !!setOrgUid;
  const canSave =
    !!form.client_uid &&
    !!form.description.trim() &&
    !!form.takeaway.trim() &&
    (!showOrgPicker || !!orgUid);

  return (
    <tr
      style={{
        background: isNew ? "#f0f9ff" : "#fffbeb",
        borderBottom: "2px solid #2563eb",
      }}
    >
      <td style={{ ...tdS, color: "#94a3b8", width: 36 }}>
        {isNew ? <span style={{ fontSize: 11, color: "#2563eb" }}>New</span> : "✏️"}
      </td>
      <td style={{ ...tdS, width: 130, color: "#475569" }}>{raisedByDisplay}</td>
      <td style={{ ...tdS, width: 160 }}>
        {showOrgPicker && setOrgUid && (
          <select
            style={{
              ...inpS,
              marginBottom: 4,
              borderColor: orgUid ? "#e2e8f0" : "#f59e0b",
            }}
            value={orgUid}
            onChange={(e) => setOrgUid(e.target.value)}
            title="Pick which organisation this kaizen belongs to"
          >
            <option value="">— Select Org * —</option>
            {orgOptions.map((o) => (
              <option key={o.uid} value={o.uid}>
                {o.name}
              </option>
            ))}
          </select>
        )}
        <select
          style={inpS}
          value={form.client_uid}
          onChange={(e) => {
            const uid = e.target.value;
            const match = clients.find((c) => c.id === uid);
            setForm((f) => ({
              ...f,
              client_uid: uid,
              client: match?.name ?? "",
            }));
          }}
        >
          <option value="">— Select Client * —</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </td>
      <td style={{ ...tdS, minWidth: 140 }}>
        <input
          style={inpS}
          value={form.area}
          onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))}
          placeholder="Area (e.g. Internal Audit)"
        />
      </td>
      <td style={{ ...tdS, minWidth: 220 }}>
        <textarea
          style={{ ...inpS, minHeight: 36, resize: "vertical" }}
          rows={2}
          value={form.description}
          onChange={(e) =>
            setForm((f) => ({ ...f, description: e.target.value }))
          }
          placeholder="Description *"
          autoFocus={isNew}
        />
      </td>
      <td style={{ ...tdS, minWidth: 220 }}>
        <textarea
          style={{ ...inpS, minHeight: 36, resize: "vertical" }}
          rows={2}
          value={form.takeaway}
          onChange={(e) => setForm((f) => ({ ...f, takeaway: e.target.value }))}
          placeholder="Take Away *"
        />
      </td>
      <td style={{ ...tdS, width: 110, color: "#475569" }}>{form.status}</td>
      <td style={{ ...tdS, width: 110, color: "#475569" }}>
        {entryDateDisplay}
      </td>
      <td style={{ ...tdS, whiteSpace: "nowrap", width: 110 }}>
        <button
          onClick={onSave}
          disabled={saving || !canSave}
          style={{
            padding: "5px 10px",
            background: canSave ? "#16a34a" : "#94a3b8",
            color: "#fff",
            border: "none",
            borderRadius: 5,
            cursor: canSave && !saving ? "pointer" : "not-allowed",
            fontSize: 11,
            fontWeight: 700,
            marginRight: 4,
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? "…" : "✓ Save"}
        </button>
        <button
          onClick={onCancel}
          style={{
            padding: "5px 8px",
            background: "#fff",
            color: "#ef4444",
            border: "1px solid #fecaca",
            borderRadius: 5,
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          ✕
        </button>
      </td>
    </tr>
  );
}
