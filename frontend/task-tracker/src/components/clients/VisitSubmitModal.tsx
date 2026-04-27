import { useEffect, useState } from "react";
import type { MasterItem } from "@/types";
import type { Profile } from "@/types/auth";

export interface SubmitModalCreatePayload {
  mode: "create";
  client: string;
  visit_date: string;
  assigned_manager: string;
  key_points: string;
  observation_attachment: File | null;
  submitImmediately: boolean;
}

export interface SubmitModalEditPayload {
  mode: "edit";
  reportUid: string;
  key_points: string;
  observation_attachment: File | null;
  submitImmediately: boolean;
}

export interface SubmitModalResubmitPayload {
  mode: "resubmit";
  reportUid: string;
  key_points: string;
  observation_attachment: File | null;
}

export type SubmitModalPayload =
  | SubmitModalCreatePayload
  | SubmitModalEditPayload
  | SubmitModalResubmitPayload;

interface CreateProps {
  mode: "create";
  open: boolean;
  defaultClientUid: string;
  clients: MasterItem[];
  managers: Profile[];
  onClose: () => void;
  onSubmit: (p: SubmitModalCreatePayload) => Promise<void>;
}
interface EditProps {
  mode: "edit";
  open: boolean;
  reportUid: string;
  initialKeyPoints: string;
  onClose: () => void;
  onSubmit: (p: SubmitModalEditPayload) => Promise<void>;
}
interface ResubmitProps {
  mode: "resubmit";
  open: boolean;
  reportUid: string;
  priorKeyPoints: string;
  managerComment: string;
  onClose: () => void;
  onSubmit: (p: SubmitModalResubmitPayload) => Promise<void>;
}

type Props = CreateProps | EditProps | ResubmitProps;

export default function VisitSubmitModal(props: Props) {
  const [client, setClient] = useState<string>(
    props.mode === "create" ? props.defaultClientUid : "",
  );
  const [visitDate, setVisitDate] = useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [assignedManager, setAssignedManager] = useState<string>("");
  const [keyPoints, setKeyPoints] = useState<string>(
    props.mode === "edit"
      ? props.initialKeyPoints
      : props.mode === "resubmit"
        ? props.priorKeyPoints
        : "",
  );
  const [file, setFile] = useState<File | null>(null);
  const [submitImmediately, setSubmitImmediately] = useState<boolean>(props.mode === "resubmit");
  const [busy, setBusy] = useState(false);

  // Reset when re-opened (avoid leaking state between rows).
  useEffect(() => {
    if (!props.open) return;
    if (props.mode === "create") {
      setClient(props.defaultClientUid);
      setVisitDate(new Date().toISOString().slice(0, 10));
      setAssignedManager("");
      setKeyPoints("");
      setFile(null);
      setSubmitImmediately(false);
    }
    if (props.mode === "edit") {
      setKeyPoints(props.initialKeyPoints);
      setFile(null);
      setSubmitImmediately(false);
    }
    if (props.mode === "resubmit") {
      setKeyPoints(props.priorKeyPoints);
      setFile(null);
      setSubmitImmediately(true);
    }
  }, [props.open, props.mode]);

  if (!props.open) return null;

  const submit = async () => {
    setBusy(true);
    try {
      if (props.mode === "create") {
        await props.onSubmit({
          mode: "create",
          client,
          visit_date: visitDate,
          assigned_manager: assignedManager,
          key_points: keyPoints,
          observation_attachment: file,
          submitImmediately,
        });
      } else if (props.mode === "edit") {
        await props.onSubmit({
          mode: "edit",
          reportUid: props.reportUid,
          key_points: keyPoints,
          observation_attachment: file,
          submitImmediately,
        });
      } else {
        await props.onSubmit({
          mode: "resubmit",
          reportUid: props.reportUid,
          key_points: keyPoints,
          observation_attachment: file,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={overlay}>
      <div style={modal}>
        <h3 style={{ margin: "0 0 12px" }}>
          {props.mode === "create" ? "New visit" : props.mode === "edit" ? "Edit draft" : "Resubmit visit report"}
        </h3>
        {props.mode === "resubmit" && (
          <div style={{ background: "#fef3c7", padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
            <strong>Manager rejected the previous report:</strong>
            <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{props.managerComment}</div>
          </div>
        )}

        {props.mode === "create" && (
          <>
            <Field label="Client">
              <select value={client} onChange={(e) => setClient(e.target.value)} style={input}>
                <option value="">Select…</option>
                {/* MasterItem.id IS the uid (see dtoToMasterItem in useMasters.ts). */}
                {props.clients.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
              </select>
            </Field>
            <Field label="Visit date">
              <input type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} style={input} />
            </Field>
            <Field label="Assigned manager">
              <select value={assignedManager} onChange={(e) => setAssignedManager(e.target.value)} style={input}>
                <option value="">Select…</option>
                {props.managers.map((p) => (<option key={p.id} value={p.id}>{p.full_name}</option>))}
              </select>
            </Field>
          </>
        )}

        <Field label="Key points">
          <textarea rows={5} value={keyPoints} onChange={(e) => setKeyPoints(e.target.value)} style={input} />
        </Field>
        <Field label="Observation report">
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>

        {props.mode !== "resubmit" && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginTop: 10 }}>
            <input
              type="checkbox"
              checked={submitImmediately}
              onChange={(e) => setSubmitImmediately(e.target.checked)}
            />
            Submit for approval immediately (otherwise saved as Draft)
          </label>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" onClick={props.onClose} style={btn}>Cancel</button>
          <button type="button" onClick={submit} disabled={busy} style={primaryBtn}>
            {busy ? "Saving…" : (props.mode === "resubmit" || submitImmediately) ? "Save & Submit" : "Save Draft"}
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
  position: "fixed", inset: 0, background: "rgba(0,0,0,.4)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
};
const modal: React.CSSProperties = {
  width: 520, maxWidth: "90vw", background: "#fff", padding: 20,
  borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,.2)",
};
const input: React.CSSProperties = { width: "100%", padding: 6, border: "1px solid #cbd5e1", borderRadius: 6 };
const btn: React.CSSProperties = { padding: "8px 14px", background: "#f1f5f9", border: "none", borderRadius: 6 };
const primaryBtn: React.CSSProperties = { ...btn, background: "#2563eb", color: "#fff" };
