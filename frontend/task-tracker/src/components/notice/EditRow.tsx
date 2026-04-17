import type { Dispatch, SetStateAction } from "react";
import { tdS, inpS } from "@/utils/tableStyles";
import type { NoticeStatusValue } from "@/types/api";
import { STATUSES } from "@/utils/notice";
import type { NoticeRow } from "@/types/notice";

export interface EditRowProps {
  form: NoticeRow;
  setForm: Dispatch<SetStateAction<NoticeRow>>;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  isNew: boolean;
}

export default function EditRow({
  form,
  setForm,
  onSave,
  onCancel,
  saving,
  isNew,
}: EditRowProps) {
  return (
    <tr
      style={{
        background: isNew ? "#f0f9ff" : "#fffbeb",
        borderBottom: "2px solid #2563eb",
      }}
    >
      <td style={{ ...tdS, color: "#94a3b8", width: 36 }}>
        {isNew ? (
          <span style={{ fontSize: 11, color: "#2563eb" }}>New</span>
        ) : (
          "✏️"
        )}
      </td>
      <td style={{ ...tdS, minWidth: 140 }}>
        <input
          style={inpS}
          value={form.client_name}
          onChange={(e) =>
            setForm((f) => ({ ...f, client_name: e.target.value }))
          }
          placeholder="Client name *"
          autoFocus={isNew}
        />
      </td>
      <td style={{ ...tdS, minWidth: 180 }}>
        <textarea
          style={{ ...inpS, minHeight: 36, resize: "vertical" }}
          rows={2}
          value={form.dispute_nature}
          onChange={(e) =>
            setForm((f) => ({ ...f, dispute_nature: e.target.value }))
          }
          placeholder="Nature of dispute *"
        />
      </td>
      <td style={{ ...tdS, width: 140 }}>
        <input
          type="date"
          style={inpS}
          value={form.received_date}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              received_date: e.target.value,
            }))
          }
        />
      </td>
      <td style={{ ...tdS, width: 130 }}>
        <input
          type="date"
          style={inpS}
          value={form.replied_date}
          onChange={(e) =>
            setForm((f) => ({ ...f, replied_date: e.target.value }))
          }
        />
      </td>
      <td style={{ ...tdS, width: 130 }}>
        <input
          type="date"
          style={inpS}
          value={form.next_target_date}
          onChange={(e) =>
            setForm((f) => ({ ...f, next_target_date: e.target.value }))
          }
        />
      </td>
      <td style={{ ...tdS, minWidth: 160 }}>
        <textarea
          style={{ ...inpS, minHeight: 36, resize: "vertical" }}
          rows={2}
          value={form.remarks}
          onChange={(e) =>
            setForm((f) => ({ ...f, remarks: e.target.value }))
          }
          placeholder="Remarks…"
        />
      </td>
      <td style={{ ...tdS, width: 110 }}>
        <select
          style={inpS}
          value={form.status}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              status: e.target.value as NoticeStatusValue,
            }))
          }
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </td>
      <td style={{ ...tdS, whiteSpace: "nowrap", width: 90 }}>
        <button
          onClick={onSave}
          disabled={saving}
          style={{
            padding: "5px 10px",
            background: "#16a34a",
            color: "#fff",
            border: "none",
            borderRadius: 5,
            cursor: "pointer",
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
