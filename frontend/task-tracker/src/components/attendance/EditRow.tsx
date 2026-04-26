import { STATUSES, LOCATIONS, tdS, inpS } from "@/utils/attendance";
import { TODAY, getDayName } from "@/utils/date";
import { computeWorkedHours, fmtWorkedHours } from "@/utils/time";
import type { AttendanceRecord } from "@/types";

export interface EditRowProps {
  form: Partial<AttendanceRecord>;
  /** Notify parent of a partial patch — parent merges it into its own state. */
  onChange: (patch: Partial<AttendanceRecord>) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  isNew?: boolean;
  isAdmin?: boolean;
  /** Login/Logout time fields are Admin-only; Managers and Employees may
   *  edit Location / Status / Remarks but not punch timing. Defaults to
   *  the value of `isAdmin` to preserve existing add-row behaviour. */
  canEditTiming?: boolean;
  memberOptions?: string[];
  minDate?: string;
}

export default function EditRow({
  form,
  onChange,
  onSave,
  onCancel,
  saving,
  isNew,
  isAdmin,
  canEditTiming,
  memberOptions,
  minDate,
}: EditRowProps) {
  const timingEditable = canEditTiming ?? isAdmin ?? false;
  const timingDisabledStyle = !timingEditable
    ? { background: "#f1f5f9", color: "#64748b", cursor: "not-allowed" }
    : {};
  const previewHours = computeWorkedHours(
    (form.login_time as string) || "",
    (form.logout_time as string) || "",
  );
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
      {isAdmin && (
        <td style={{ ...tdS, minWidth: 130 }}>
          <select
            style={inpS}
            value={(form.employee_name as string) || ""}
            onChange={(e) => onChange({ employee_name: e.target.value })}
          >
            <option value="">— Select —</option>
            {(memberOptions || []).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </td>
      )}
      <td style={{ ...tdS, width: 120 }}>
        <input
          type="date"
          style={inpS}
          value={form.date as string}
          min={minDate}
          max={TODAY}
          onChange={(e) => onChange({ date: e.target.value })}
        />
      </td>
      <td style={{ ...tdS, width: 50, fontSize: 11, color: "#94a3b8" }}>
        {getDayName(form.date as string)}
      </td>
      <td style={{ ...tdS, width: 100 }}>
        <input
          type="time"
          style={{ ...inpS, ...timingDisabledStyle }}
          value={(form.login_time as string) || ""}
          onChange={(e) => onChange({ login_time: e.target.value })}
          disabled={!timingEditable}
          title={timingEditable ? undefined : "Only Admins can edit punch timing"}
        />
      </td>
      <td style={{ ...tdS, width: 100 }}>
        <input
          type="time"
          style={{ ...inpS, ...timingDisabledStyle }}
          value={(form.logout_time as string) || ""}
          onChange={(e) => onChange({ logout_time: e.target.value })}
          disabled={!timingEditable}
          title={timingEditable ? undefined : "Only Admins can edit punch timing"}
        />
      </td>
      <td
        style={{
          ...tdS,
          width: 80,
          fontSize: 12,
          fontWeight: 600,
          color: previewHours != null && previewHours < 4 ? "#dc2626" : "#0f172a",
        }}
        title={previewHours != null ? `${previewHours} hours` : ""}
      >
        {fmtWorkedHours(previewHours)}
      </td>
      <td style={{ ...tdS, width: 120 }}>
        <select
          style={inpS}
          value={(form.work_location as string) || "Office"}
          onChange={(e) => onChange({ work_location: e.target.value })}
        >
          {LOCATIONS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </td>
      <td style={{ ...tdS, width: 110 }}>
        <select
          style={inpS}
          value={form.status as string}
          onChange={(e) => onChange({ status: e.target.value })}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </td>
      <td style={{ ...tdS, minWidth: 120 }}>
        <input
          style={inpS}
          value={(form.remarks as string) || ""}
          onChange={(e) => onChange({ remarks: e.target.value })}
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
