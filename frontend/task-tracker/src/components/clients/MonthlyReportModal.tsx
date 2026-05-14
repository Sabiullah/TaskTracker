import { useEffect, useMemo, useState } from "react";
import { deleteMonthlyReportAttachment } from "@/lib/api";
import { filterClientsForAdd } from "@/utils/clientFilters";
import type { MonthlyReportAttachmentDto } from "@/types/api/monthlyReports";
import type { MasterItem } from "@/types";
import type { Profile } from "@/types/auth";

export interface CreatePayload {
  mode: "create";
  client: string;
  year_month: string;
  report_date: string;
  report_name: string;
  key_points: string;
  assigned_manager: string;
  newFiles: File[];
  submitImmediately: boolean;
}

export interface EditPayload {
  mode: "edit";
  reportUid: string;
  report_date: string;
  report_name: string;
  key_points: string;
  assigned_manager: string;
  year_month: string;
  newFiles: File[];
  submitImmediately: boolean;
}

interface CreateProps {
  mode: "create";
  open: boolean;
  defaultClientUid: string;
  defaultYearMonth: string;
  clients: MasterItem[];
  managers: Profile[];
  onClose: () => void;
  onSubmit: (p: CreatePayload) => Promise<void>;
}

interface EditProps {
  mode: "edit";
  open: boolean;
  reportUid: string;
  initialClientName: string;
  initialReportName: string;
  initialReportDate: string;
  initialYearMonth: string;
  initialKeyPoints: string;
  initialManager: string;
  managers: Profile[];
  existingAttachments: readonly MonthlyReportAttachmentDto[];
  managerComment?: string;
  onClose: () => void;
  onSubmit: (p: EditPayload) => Promise<void>;
  onAttachmentDeleted: (attachmentUid: string) => void;
}

type Props = CreateProps | EditProps;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function ymOfDate(iso: string) {
  return iso.slice(0, 7);
}

export default function MonthlyReportModal(props: Props) {
  const isCreate = props.mode === "create";
  const isEdit = props.mode === "edit";

  const initClient = isCreate ? props.defaultClientUid : "";
  const initYM = isCreate ? props.defaultYearMonth : props.initialYearMonth;
  const initDate = isCreate ? todayISO() : props.initialReportDate;
  const initName = isCreate ? "" : props.initialReportName;
  const initKp = isCreate ? "" : props.initialKeyPoints;
  const initMgr = isCreate ? "" : props.initialManager;

  const [client, setClient] = useState<string>(initClient);
  const [yearMonth, setYearMonth] = useState<string>(initYM);
  const [reportDate, setReportDate] = useState<string>(initDate);
  const [reportName, setReportName] = useState<string>(initName);
  const [keyPoints, setKeyPoints] = useState<string>(initKp);
  const [assignedManager, setAssignedManager] = useState<string>(initMgr);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [submitImmediately, setSubmitImmediately] = useState<boolean>(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");

  // The client picker only renders in create mode (edit mode shows a
  // disabled text input). Drop deactivated clients so new monthly
  // reports can't be started against them. Existing reports retain
  // their stored client_uid regardless.
  const createClients = isCreate ? props.clients : null;
  const visibleClients = useMemo(
    () => (createClients ? filterClientsForAdd(createClients) : []),
    [createClients],
  );

  useEffect(() => {
    if (!props.open) return;
    setClient(initClient);
    setYearMonth(initYM);
    setReportDate(initDate);
    setReportName(initName);
    setKeyPoints(initKp);
    setAssignedManager(initMgr);
    setNewFiles([]);
    setSubmitImmediately(false);
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open]);

  if (!props.open) return null;

  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files ? Array.from(e.target.files) : [];
    if (picked.length) setNewFiles((prev) => [...prev, ...picked]);
    e.target.value = "";
  };

  const removeNewFileAt = (idx: number) =>
    setNewFiles((prev) => prev.filter((_, i) => i !== idx));

  const removeExisting = async (attUid: string) => {
    if (!isEdit) return;
    await deleteMonthlyReportAttachment(attUid);
    (props as EditProps).onAttachmentDeleted(attUid);
  };

  const onReportDateChange = (v: string) => {
    setReportDate(v);
    if (v) setYearMonth(ymOfDate(v));
  };

  const validate = (): string => {
    if (isCreate && !client) return "Please select a client.";
    if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) return "Please pick a valid month.";
    if (!reportDate) return "Please select a report date.";
    if (!reportName.trim()) return "Report name is required.";
    if (!assignedManager) return "Please select an approving manager.";
    return "";
  };

  const submit = async () => {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setError("");
    setBusy(true);
    try {
      if (isCreate) {
        await props.onSubmit({
          mode: "create",
          client,
          year_month: yearMonth,
          report_date: reportDate,
          report_name: reportName.trim(),
          key_points: keyPoints,
          assigned_manager: assignedManager,
          newFiles,
          submitImmediately,
        });
      } else {
        await props.onSubmit({
          mode: "edit",
          reportUid: props.reportUid,
          report_date: reportDate,
          report_name: reportName.trim(),
          key_points: keyPoints,
          assigned_manager: assignedManager,
          year_month: yearMonth,
          newFiles,
          submitImmediately,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const existing = isEdit ? props.existingAttachments : [];
  const managers = isCreate ? props.managers : props.managers;

  return (
    <div style={overlay}>
      <div style={modal}>
        <h3 style={{ margin: "0 0 12px" }}>
          {isCreate ? "New monthly report" : "Edit monthly report"}
        </h3>

        {isEdit && props.managerComment ? (
          <div style={rejectionBanner}>
            <strong>Manager comment:</strong>
            <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{props.managerComment}</div>
          </div>
        ) : null}

        {isCreate && (
          <Field label="Client">
            <select value={client} onChange={(e) => setClient(e.target.value)} style={input}>
              <option value="">Select…</option>
              {visibleClients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {isEdit && (
          <Field label="Client">
            <input type="text" value={props.initialClientName} disabled style={{ ...input, background: "#f8fafc" }} />
          </Field>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Report date">
            <input
              type="date"
              value={reportDate}
              onChange={(e) => onReportDateChange(e.target.value)}
              style={input}
            />
          </Field>
          <Field label="Report month">
            <input
              type="month"
              value={yearMonth}
              onChange={(e) => setYearMonth(e.target.value)}
              style={input}
            />
          </Field>
        </div>

        <Field label="Report name">
          <input
            type="text"
            placeholder="e.g. April 2026 — Performance Review"
            value={reportName}
            onChange={(e) => setReportName(e.target.value)}
            style={input}
          />
        </Field>

        <Field label="Approving manager">
          <select
            value={assignedManager}
            onChange={(e) => setAssignedManager(e.target.value)}
            style={input}
          >
            <option value="">Select…</option>
            {managers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Key points">
          <textarea
            rows={5}
            placeholder="Highlights, achievements, issues, next steps…"
            value={keyPoints}
            onChange={(e) => setKeyPoints(e.target.value)}
            style={input}
          />
        </Field>

        <Field label="Attachments (multiple)">
          <input type="file" multiple onChange={onPickFiles} />
          {(existing.length > 0 || newFiles.length > 0) && (
            <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {existing.map((att) => (
                <span key={att.uid} style={chip}>
                  📎 {att.filename}
                  <button
                    type="button"
                    aria-label={`Remove ${att.filename}`}
                    onClick={() => void removeExisting(att.uid)}
                    style={chipX}
                  >
                    ×
                  </button>
                </span>
              ))}
              {newFiles.map((f, i) => (
                <span key={`${f.name}-${i}`} style={chip}>
                  📎 {f.name}
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    onClick={() => removeNewFileAt(i)}
                    style={chipX}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </Field>

        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginTop: 10 }}>
          <input
            type="checkbox"
            checked={submitImmediately}
            onChange={(e) => setSubmitImmediately(e.target.checked)}
          />
          Submit for manager approval immediately (otherwise saved as Draft)
        </label>

        {error && (
          <div style={{ color: "#b91c1c", fontSize: 13, marginTop: 10 }}>{error}</div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" onClick={props.onClose} style={btn}>
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={busy} style={primaryBtn}>
            {busy ? "Saving…" : submitImmediately ? "Save & Submit" : "Save Draft"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: 10, fontSize: 13, fontWeight: 600 }}>
      <div style={{ marginBottom: 4 }}>{label}</div>
      {children}
    </label>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};
const modal: React.CSSProperties = {
  width: 560,
  maxWidth: "92vw",
  maxHeight: "90vh",
  overflowY: "auto",
  background: "#fff",
  padding: 20,
  borderRadius: 8,
  boxShadow: "0 8px 24px rgba(0,0,0,.2)",
};
const input: React.CSSProperties = { width: "100%", padding: 6, border: "1px solid #cbd5e1", borderRadius: 6 };
const btn: React.CSSProperties = { padding: "8px 14px", background: "#f1f5f9", border: "none", borderRadius: 6, cursor: "pointer" };
const primaryBtn: React.CSSProperties = { ...btn, background: "#2563eb", color: "#fff" };
const chip: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "3px 6px 3px 8px",
  background: "#f1f5f9",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
};
const chipX: React.CSSProperties = {
  background: "transparent",
  border: "none",
  padding: "0 4px",
  cursor: "pointer",
  fontSize: 14,
  lineHeight: 1,
  color: "#475569",
};
const rejectionBanner: React.CSSProperties = {
  background: "#fef3c7",
  padding: 10,
  borderRadius: 6,
  marginBottom: 12,
  fontSize: 13,
};
