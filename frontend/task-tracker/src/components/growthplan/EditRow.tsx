import type { CSSProperties, Dispatch, SetStateAction } from "react";
import { tdS as sharedTdS, inpS } from "@/utils/tableStyles";
import type {
  GrowthPlanPriorityValue,
  GrowthPlanStatusValue,
} from "@/types/api";
import { PRIORITIES, STATUSES } from "@/utils/growthplan";
import type { PlanRow } from "@/types/growthplan";

const tdS: CSSProperties = { ...sharedTdS, verticalAlign: "top" };

export interface OrgOption {
  uid: string;
  name: string;
}

export interface EditRowProps {
  form: PlanRow;
  setForm: Dispatch<SetStateAction<PlanRow>>;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  isNew: boolean;
  memberOptions: string[];
  /** Orgs the caller can create rows in. When length > 1 and ``isNew``,
   *  an Org dropdown appears above the Activity field so the user can
   *  disambiguate without having to switch the header filter. Only used
   *  on new rows — edits already belong to an org. */
  orgOptions?: OrgOption[];
  orgUid?: string;
  setOrgUid?: (uid: string) => void;
}

export default function EditRow({
  form,
  setForm,
  onSave,
  onCancel,
  saving,
  isNew,
  memberOptions,
  orgOptions = [],
  orgUid = "",
  setOrgUid,
}: EditRowProps) {
  const showOrgPicker = isNew && orgOptions.length > 1 && !!setOrgUid;
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
      <td style={{ ...tdS, minWidth: 200 }}>
        {showOrgPicker && setOrgUid && (
          <select
            style={{
              ...inpS,
              marginBottom: 4,
              borderColor: orgUid ? "#e2e8f0" : "#f59e0b",
            }}
            value={orgUid}
            onChange={(e) => setOrgUid(e.target.value)}
            title="Pick which organisation this plan belongs to"
          >
            <option value="">— Select Org * —</option>
            {orgOptions.map((o) => (
              <option key={o.uid} value={o.uid}>
                {o.name}
              </option>
            ))}
          </select>
        )}
        <textarea
          style={{ ...inpS, minHeight: 36, resize: "vertical" }}
          rows={2}
          value={form.activity}
          onChange={(e) => setForm((f) => ({ ...f, activity: e.target.value }))}
          placeholder="Growth plan activity *"
          autoFocus={isNew}
        />
      </td>
      <td style={{ ...tdS, width: 130 }}>
        <input
          type="month"
          style={inpS}
          value={form.target_month}
          onChange={(e) =>
            setForm((f) => ({ ...f, target_month: e.target.value }))
          }
        />
      </td>
      <td style={{ ...tdS, minWidth: 180 }}>
        <textarea
          style={{ ...inpS, minHeight: 36, resize: "vertical" }}
          rows={2}
          value={form.steps_taken}
          onChange={(e) =>
            setForm((f) => ({ ...f, steps_taken: e.target.value }))
          }
          placeholder="Steps taken so far…"
        />
      </td>
      <td style={{ ...tdS, minWidth: 180 }}>
        <textarea
          style={{ ...inpS, minHeight: 36, resize: "vertical" }}
          rows={2}
          value={form.steps_to_take}
          onChange={(e) =>
            setForm((f) => ({ ...f, steps_to_take: e.target.value }))
          }
          placeholder="Steps to be taken…"
        />
      </td>
      <td style={{ ...tdS, width: 100 }}>
        <select
          style={inpS}
          value={form.priority}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              priority: e.target.value as GrowthPlanPriorityValue,
            }))
          }
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </td>
      <td style={{ ...tdS, width: 120 }}>
        <select
          style={inpS}
          value={form.assigned_to}
          onChange={(e) =>
            setForm((f) => ({ ...f, assigned_to: e.target.value }))
          }
        >
          <option value="">— Select —</option>
          {memberOptions.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </td>
      <td style={{ ...tdS, width: 130 }}>
        <select
          style={inpS}
          value={form.status}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              status: e.target.value as GrowthPlanStatusValue,
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
      <td style={{ ...tdS, minWidth: 120 }}>
        <textarea
          style={{ ...inpS, minHeight: 36, resize: "vertical" }}
          rows={2}
          value={form.remarks}
          onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))}
          placeholder="Remarks…"
        />
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
