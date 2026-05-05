import { Fragment, useState } from "react";
import { openAuthenticatedFile } from "@/lib/api";
import VisitReviewPanel from "./VisitReviewPanel";
import VisitSentInfoPanel from "./VisitSentInfoPanel";
import VisitTimelinePanel from "./VisitTimelinePanel";
import type { ClientVisitDto, VisitSentInfoForm } from "@/types/api/internalReports";

interface Props {
  visit: ClientVisitDto;
  currentUserUid: string;
  isOrgAdmin: boolean;
  canDelete: boolean;
  onEditDraft: (reportUid: string, currentKeyPoints: string) => void;
  onSubmit: (reportUid: string) => Promise<void>;
  onApprove: (reportUid: string) => Promise<void>;
  onReject: (reportUid: string, comment: string) => Promise<void>;
  onResubmit: (reportUid: string, priorKeyPoints: string, managerComment: string) => void;
  onSetSentInfo: (uid: string, form: VisitSentInfoForm) => Promise<void>;
  onDelete: (uid: string) => Promise<void>;
}

export default function ClientVisitRow({
  visit, currentUserUid, isOrgAdmin, canDelete,
  onEditDraft, onSubmit, onApprove, onReject, onResubmit, onSetSentInfo, onDelete,
}: Props) {
  const [open, setOpen] = useState(false);
  const isAuthor = visit.prepared_by === currentUserUid;
  const isAssignedManager = visit.assigned_manager === currentUserUid;
  const canReview = isAssignedManager || isOrgAdmin;
  const canEditSentInfo = isAssignedManager || isOrgAdmin;
  const latest = [...visit.reports].sort((a, b) => b.revision_number - a.revision_number)[0];

  return (
    <Fragment>
      <tr
        onClick={() => setOpen((o) => !o)}
        style={{ borderBottom: "1px solid #e2e8f0", cursor: "pointer", background: open ? "#f8fafc" : "transparent" }}
      >
        <td style={{ ...td, width: 24, color: "#64748b" }}>{open ? "▾" : "▸"}</td>
        <td style={td}>{visit.visit_date}</td>
        <td style={td}>{visit.prepared_by_detail?.full_name ?? "—"}</td>
        <td style={td}>{visit.assigned_manager_detail?.full_name ?? "—"}</td>
        <td style={td}><StatusPill status={visit.current_status} /></td>
        <td style={td}>{visit.report_sent_date ?? "—"}</td>
        <td style={td}>
          {visit.voice_note_sent
            ? <span style={voiceSentPill}>✓ Sent</span>
            : <span style={{ color: "#94a3b8" }}>—</span>}
        </td>
        <td style={td}>{visit.is_overdue ? <span style={overduePill}>⚠ Overdue</span> : ""}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={8} style={{ padding: 0, borderBottom: "1px solid #e2e8f0" }}>
            <div style={{ background: "#fff", padding: 14, display: "flex", flexDirection: "column", gap: 18 }}>
              <section>
                <h4 style={sectionH}>Revisions</h4>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", textAlign: "left" }}>
                      <th style={th}>Rev</th>
                      <th style={th}>Status</th>
                      <th style={th}>Submitted</th>
                      <th style={th}>Reviewed by</th>
                      <th style={th}>Comment</th>
                      <th style={th}>File</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visit.reports.map((r) => (
                      <tr key={r.uid}>
                        <td style={td}>#{r.revision_number}</td>
                        <td style={td}><StatusPill status={r.status} /></td>
                        <td style={td}>{r.submitted_at ? new Date(r.submitted_at).toLocaleString() : "—"}</td>
                        <td style={td}>{r.reviewed_by_detail?.full_name ?? "—"}</td>
                        <td style={td}>{r.manager_comment || "—"}</td>
                        <td style={td}>
                          {r.attachments.length === 0 ? "—" : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              {r.attachments.map((att) => (
                                <button
                                  key={att.uid}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void openAuthenticatedFile(att.download_url);
                                  }}
                                  style={linkBtn}
                                >
                                  📎 {att.filename}
                                </button>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Author actions on the latest revision */}
                {isAuthor && latest && (
                  <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                    {latest.status === "Draft" && (
                      <>
                        <button type="button" style={primaryBtn}
                          onClick={(e) => { e.stopPropagation(); onEditDraft(latest.uid, latest.key_points); }}>
                          Edit
                        </button>
                        <button type="button" style={primaryBtn}
                          onClick={(e) => { e.stopPropagation(); void onSubmit(latest.uid); }}>
                          Submit
                        </button>
                      </>
                    )}
                    {latest.status === "Pending" && (
                      <button type="button" style={btn}
                        onClick={(e) => { e.stopPropagation(); onEditDraft(latest.uid, latest.key_points); }}>
                        Edit while pending
                      </button>
                    )}
                    {latest.status === "Rejected" && (
                      <button type="button" style={primaryBtn}
                        onClick={(e) => { e.stopPropagation(); onResubmit(latest.uid, latest.key_points, latest.manager_comment); }}>
                        Resubmit
                      </button>
                    )}
                  </div>
                )}

                {/* Manager actions on a Pending latest */}
                {canReview && latest && latest.status === "Pending" && (
                  <div style={{ marginTop: 8 }}>
                    <VisitReviewPanel
                      onApprove={() => onApprove(latest.uid)}
                      onReject={(c) => onReject(latest.uid, c)}
                    />
                  </div>
                )}

                {/* Admin-only: delete the entire visit (and all its revisions). */}
                {canDelete && (
                  <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      style={dangerBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        const ok = window.confirm(
                          `Delete this visit (${visit.visit_date}) and all its revisions? This cannot be undone.`,
                        );
                        if (ok) void onDelete(visit.uid);
                      }}
                    >
                      Delete visit
                    </button>
                  </div>
                )}
              </section>

              {visit.reports.some((r) => r.status === "Approved") && (
                <section>
                  <h4 style={sectionH}>Sent to client</h4>
                  <VisitSentInfoPanel
                    visit={visit}
                    canEdit={canEditSentInfo}
                    onSave={(form) => onSetSentInfo(visit.uid, form)}
                  />
                </section>
              )}

              <section>
                <h4 style={sectionH}>Timeline</h4>
                <VisitTimelinePanel events={visit.audit_events} />
              </section>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, [string, string]> = {
    Draft: ["#f1f5f9", "#475569"],
    Pending: ["#fef3c7", "#92400e"],
    Approved: ["#dcfce7", "#166534"],
    Rejected: ["#fee2e2", "#b91c1c"],
  };
  const [bg, fg] = colors[status] ?? ["#f1f5f9", "#475569"];
  return (
    <span style={{ background: bg, color: fg, padding: "2px 8px", borderRadius: 999, fontSize: 12, fontWeight: 600 }}>
      {status}
    </span>
  );
}

const overduePill: React.CSSProperties = {
  background: "#fee2e2", color: "#b91c1c", padding: "2px 8px",
  borderRadius: 999, fontSize: 12, fontWeight: 700,
};
const voiceSentPill: React.CSSProperties = {
  background: "#dcfce7", color: "#166534", padding: "2px 8px",
  borderRadius: 999, fontSize: 12, fontWeight: 600,
};
const td: React.CSSProperties = { padding: "8px 10px", verticalAlign: "top" };
const th: React.CSSProperties = { padding: "8px 10px", fontWeight: 600, borderBottom: "1px solid #e2e8f0" };
const sectionH: React.CSSProperties = { margin: "0 0 8px", fontSize: 14 };
const btn: React.CSSProperties = { padding: "6px 12px", background: "#f1f5f9", border: "none", borderRadius: 6, cursor: "pointer" };
const primaryBtn: React.CSSProperties = { ...btn, background: "#2563eb", color: "#fff" };
const dangerBtn: React.CSSProperties = { ...btn, background: "#dc2626", color: "#fff", fontWeight: 600 };
const linkBtn: React.CSSProperties = {
  background: "none", border: "none", padding: 0, color: "#2563eb",
  cursor: "pointer", fontSize: 13,
};
