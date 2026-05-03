import { STATUSES, STATUS_CFG, LOCATIONS, tdS, inpS } from "@/utils/attendance";
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
  /** Status is admin-only by default — employees see a read-only badge
   *  (status is auto-derived from worked hours). Defaults to `isAdmin`. */
  canEditStatus?: boolean;
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
  canEditStatus,
  memberOptions,
  minDate,
}: EditRowProps) {
  const timingEditable = canEditTiming ?? isAdmin ?? false;
  const statusEditable = canEditStatus ?? isAdmin ?? false;
  const timingDisabledStyle = !timingEditable
    ? { background: "#f1f5f9", color: "#64748b", cursor: "not-allowed" }
    : {};
  const previewHours = computeWorkedHours(
    (form.login_time as string) || "",
    (form.logout_time as string) || "",
  );
  const statusKey = (form.status as string) || "Present";
  const statusCfg = STATUS_CFG[statusKey] ?? STATUS_CFG["Present"];
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
          // Editing punch timing clears the manual override — admin is
          // adjusting the source-of-truth, so re-enable hours-based
          // auto-derivation. To pin a status afterwards, change Status.
          onChange={(e) =>
            onChange({ login_time: e.target.value, manual_status_override: false })
          }
          disabled={!timingEditable}
          title={timingEditable ? undefined : "Only Admins can edit punch timing"}
        />
      </td>
      <td style={{ ...tdS, width: 100 }}>
        <input
          type="time"
          style={{ ...inpS, ...timingDisabledStyle }}
          value={(form.logout_time as string) || ""}
          onChange={(e) =>
            onChange({ logout_time: e.target.value, manual_status_override: false })
          }
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
        {statusEditable ? (
          <select
            style={inpS}
            value={form.status as string}
            title="Pinning a status here marks the row as a manual override — server stops auto-deriving from hours until you change the times again."
            onChange={(e) =>
              onChange({
                status: e.target.value,
                // Admin pinned the status → tell the server not to recompute
                // it from hours. Without this flag the next save would
                // overwrite the choice.
                manual_status_override: true,
              })
            }
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ) : (
          <span
            title="Status is auto-derived from worked hours: > 6h → Present, 4–6h → Half Day, < 4h → Absent. Only Admins can override."
            style={{
              padding: "2px 8px",
              borderRadius: 10,
              fontSize: 10,
              fontWeight: 700,
              background: statusCfg.bg,
              color: statusCfg.color,
              display: "inline-block",
            }}
          >
            {statusCfg.icon} {statusKey}
          </span>
        )}
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
