import { useState } from "react";
import ClientVisitRow from "./ClientVisitRow";
import type { VisitGroup } from "./internalReportGrouping";
import type { ClientVisitDto, VisitSentInfoForm } from "@/types/api/internalReports";

interface Props {
  groups: VisitGroup[];
  currentUserUid: string;
  isOrgAdmin: boolean;
  isAdminInOrg: (orgUid: string | null) => boolean;
  /** Per-client count of visits pending the current user's approval. Drawn as
   *  a red badge in each client group header so it surfaces regardless of
   *  which list filters the user has applied. */
  pendingMyApprovalByClient?: ReadonlyMap<string, number>;
  onAddVisit: (clientUid: string) => void;
  onEditDraft: (reportUid: string, currentKeyPoints: string) => void;
  onSubmit: (reportUid: string) => Promise<void>;
  onApprove: (reportUid: string) => Promise<void>;
  onReject: (reportUid: string, comment: string) => Promise<void>;
  onResubmit: (reportUid: string, priorKeyPoints: string, managerComment: string) => void;
  onSetSentInfo: (uid: string, form: VisitSentInfoForm) => Promise<void>;
  onDeleteVisit: (uid: string) => Promise<void>;
}

export default function ClientVisitGroupedView(p: Props) {
  const [openClients, setOpenClients] = useState<Set<string>>(new Set());
  if (!p.groups.length) return <div style={{ color: "#64748b" }}>No visits yet.</div>;
  return (
    <>
      {p.groups.map((g) => {
        const isOpen = openClients.has(g.clientUid);
        const pendingCount = p.pendingMyApprovalByClient?.get(g.clientUid) ?? 0;
        return (
          <div
            key={g.clientUid}
            style={{ marginBottom: 8, border: "1px solid #e2e8f0", borderRadius: 6, overflow: "hidden" }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                background: isOpen ? "#eff6ff" : "#f8fafc",
                borderBottom: isOpen ? "1px solid #e2e8f0" : "none",
              }}
            >
              <button
                type="button"
                onClick={() =>
                  setOpenClients((prev) => {
                    const next = new Set(prev);
                    if (next.has(g.clientUid)) next.delete(g.clientUid);
                    else next.add(g.clientUid);
                    return next;
                  })
                }
                style={{
                  flex: 1,
                  textAlign: "left",
                  padding: "10px 12px",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span style={{ width: 12 }}>{isOpen ? "▾" : "▸"}</span>
                <span>{g.clientName}</span>
                <span style={{ color: "#64748b", fontWeight: 400 }}>
                  ({g.visits.length} visit{g.visits.length === 1 ? "" : "s"})
                </span>
                {pendingCount > 0 && (
                  <span
                    aria-label={`${pendingCount} pending my approval`}
                    title={`${pendingCount} pending my approval`}
                    style={{
                      padding: "2px 8px",
                      background: "#dc2626",
                      color: "#fff",
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 700,
                      lineHeight: 1.4,
                    }}
                  >
                    {pendingCount} pending my approval
                  </span>
                )}
              </button>
              {g.clientUid !== "unassigned" && (
                <button
                  type="button"
                  onClick={() => p.onAddVisit(g.clientUid)}
                  style={{
                    margin: "0 10px",
                    padding: "5px 10px",
                    background: "#2563eb",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  + New visit
                </button>
              )}
            </div>
            {isOpen && (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#fafafa", textAlign: "left" }}>
                    <th style={th}></th>
                    <th style={th}>Visit Date</th>
                    <th style={th}>Prepared By</th>
                    <th style={th}>Manager</th>
                    <th style={th}>Status</th>
                    <th style={th}>Sent Date</th>
                    <th style={th}>Voice Note</th>
                    <th style={th}>Overdue?</th>
                  </tr>
                </thead>
                <tbody>
                  {g.visits.map((v: ClientVisitDto) => (
                    <ClientVisitRow
                      key={v.uid}
                      visit={v}
                      currentUserUid={p.currentUserUid}
                      isOrgAdmin={p.isOrgAdmin}
                      canDelete={p.isAdminInOrg(v.org_uid)}
                      onEditDraft={p.onEditDraft}
                      onSubmit={p.onSubmit}
                      onApprove={p.onApprove}
                      onReject={p.onReject}
                      onResubmit={p.onResubmit}
                      onSetSentInfo={p.onSetSentInfo}
                      onDelete={p.onDeleteVisit}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </>
  );
}

const th: React.CSSProperties = {
  padding: "8px 10px",
  fontWeight: 600,
  borderBottom: "1px solid #e2e8f0",
};
