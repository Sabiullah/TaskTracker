import { useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useMasters } from "@/hooks/useMasters";
import { useMonthlyReports } from "@/hooks/useMonthlyReports";
import { openAuthenticatedFile, uploadMonthlyReportAttachment } from "@/lib/api";
import MultiSelect from "@/components/ui/MultiSelect";
import MonthlyReportModal, {
  type CreatePayload,
  type EditPayload,
} from "./MonthlyReportModal";
import { reportApiError } from "./errors";
import type { Profile } from "@/types/auth";
import type {
  ClientMonthlyReportDto,
  MonthlyReportStatus,
} from "@/types/api/monthlyReports";
import type { MasterItem } from "@/types";

interface Props {
  clientUid: string;
  selectedOrg: string | null;
  profile: Profile | null;
  profiles: Profile[];
}

const STATUSES: MonthlyReportStatus[] = [
  "Draft",
  "Pending",
  "Approved",
  "Reviewed",
  "Rejected",
];

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatYM(ym: string): string {
  if (!/^\d{4}-\d{2}$/.test(ym)) return ym;
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

const STATUS_COLORS: Record<MonthlyReportStatus, { bg: string; fg: string }> = {
  Draft: { bg: "#f1f5f9", fg: "#475569" },
  Pending: { bg: "#fef3c7", fg: "#92400e" },
  Approved: { bg: "#dbeafe", fg: "#1e40af" },
  Reviewed: { bg: "#dcfce7", fg: "#166534" },
  Rejected: { bg: "#fee2e2", fg: "#b91c1c" },
};

export default function ClientMonthlyReportTab({
  clientUid,
  selectedOrg,
  profile,
  profiles,
}: Props) {
  const { isAdminInAny, isAdminIn, isManagerInAny } = useAuth();
  const { clients } = useMasters();
  const me = profile?.id ?? "";

  // "" = All audits (no month restriction); "YYYY-MM" narrows to one month.
  const [monthFilter, setMonthFilter] = useState<string>("");
  // "" = any date; "YYYY-MM-DD" narrows to reports dated that day.
  const [dateFilter, setDateFilter] = useState<string>("");
  const [preparedByUids, setPreparedByUids] = useState<string[]>([]);
  const [assignedManagerUids, setAssignedManagerUids] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [pendingMyApproval, setPendingMyApproval] = useState(false);
  const [pendingMyReview, setPendingMyReview] = useState(false);
  const [hideNotRequired, setHideNotRequired] = useState(false);

  const {
    reports,
    requirements,
    loading,
    createNew,
    editReport,
    removeReport,
    submit,
    approve,
    reject,
    review,
    setRequirement,
  } = useMonthlyReports({ year_month: monthFilter || undefined });

  const [modalState, setModalState] = useState<
    | { mode: "closed" }
    | { mode: "create"; defaultClientUid: string; defaultYearMonth: string }
    | { mode: "edit"; report: ClientMonthlyReportDto }
  >({ mode: "closed" });

  // Clients whose report list is expanded (collapsed by default, like the
  // Observation Report's grouped view).
  const [openClients, setOpenClients] = useState<Set<string>>(new Set());
  const toggleClient = (uid: string) =>
    setOpenClients((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });

  // Scope clients by org (and by selected client filter, if any).
  const scopedClients: MasterItem[] = useMemo(() => {
    let list = clients;
    if (selectedOrg) list = list.filter((c) => c.orgs.includes(selectedOrg));
    if (clientUid) list = list.filter((c) => c.id === clientUid);
    return list;
  }, [clients, selectedOrg, clientUid]);

  // Map client uid -> persistent requirement object. The flag is global
  // per (org, client) so the same value is shown for every month.
  const requirementByClient = useMemo(() => {
    const map = new Map<string, { uid: string; required: boolean }>();
    for (const r of requirements) {
      if (selectedOrg && r.org_uid !== selectedOrg) continue;
      if (r.client_detail) {
        map.set(r.client_detail.uid, { uid: r.uid, required: r.required });
      }
    }
    return map;
  }, [requirements, selectedOrg]);

  // Months that actually have reports — options for the AUDITS selector.
  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of reports) set.add(r.year_month);
    if (monthFilter) set.add(monthFilter);
    return [...set].sort().reverse();
  }, [reports, monthFilter]);

  // Map client uid -> array of reports for this client matching the
  // month/date filters ("" = no restriction).
  const reportsByClient = useMemo(() => {
    const map = new Map<string, ClientMonthlyReportDto[]>();
    for (const r of reports) {
      if (monthFilter && r.year_month !== monthFilter) continue;
      if (dateFilter && r.report_date !== dateFilter) continue;
      if (selectedOrg && r.org_uid !== selectedOrg) continue;
      if (clientUid && r.client !== clientUid) continue;
      const list = map.get(r.client) ?? [];
      list.push(r);
      map.set(r.client, list);
    }
    return map;
  }, [reports, monthFilter, dateFilter, selectedOrg, clientUid]);

  // Apply column filters to a single report.
  const matchesFilters = (r: ClientMonthlyReportDto): boolean => {
    if (preparedByUids.length && !preparedByUids.includes(r.prepared_by ?? "")) return false;
    if (assignedManagerUids.length && !assignedManagerUids.includes(r.assigned_manager ?? "")) return false;
    if (statuses.length && !statuses.includes(r.status)) return false;
    if (pendingMyApproval) {
      const isManager = r.assigned_manager === me;
      const isAdmin = isAdminIn(r.org_uid);
      if (r.status !== "Pending") return false;
      if (!isManager && !isAdmin) return false;
    }
    if (pendingMyReview) {
      if (r.status !== "Approved") return false;
      if (!isAdminIn(r.org_uid)) return false;
    }
    return true;
  };

  // Build the rendered list: one row per (client × required-toggle) plus its
  // associated reports. We always show every scoped client so the toggle is
  // discoverable; "hide not required" filters them down to the actionable set.
  const clientRows = useMemo(() => {
    const rows: Array<{
      client: MasterItem;
      requirement: { uid: string; required: boolean } | null;
      reports: ClientMonthlyReportDto[];
    }> = [];
    for (const c of scopedClients) {
      const req = requirementByClient.get(c.id) ?? null;
      const cReports = (reportsByClient.get(c.id) ?? []).filter(matchesFilters);
      const hasReports = cReports.length > 0;
      const isRequired = req?.required ?? false;
      if (hideNotRequired && !isRequired && !hasReports) continue;
      rows.push({ client: c, requirement: req, reports: cReports });
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    scopedClients,
    requirementByClient,
    reportsByClient,
    hideNotRequired,
    preparedByUids,
    assignedManagerUids,
    statuses,
    pendingMyApproval,
    pendingMyReview,
    me,
  ]);

  // Top-level summary counts for the current filter selection.
  const summary = useMemo(() => {
    let required = 0;
    let drafted = 0;
    let pending = 0;
    let approved = 0;
    let reviewed = 0;
    let rejected = 0;
    for (const c of scopedClients) {
      const req = requirementByClient.get(c.id);
      if (req?.required) required += 1;
    }
    for (const list of reportsByClient.values()) {
      for (const r of list) {
        if (r.status === "Draft") drafted += 1;
        else if (r.status === "Pending") pending += 1;
        else if (r.status === "Approved") approved += 1;
        else if (r.status === "Reviewed") reviewed += 1;
        else if (r.status === "Rejected") rejected += 1;
      }
    }
    return { required, drafted, pending, approved, reviewed, rejected };
  }, [scopedClients, requirementByClient, reportsByClient]);

  if (loading) return <div>Loading…</div>;

  const onToggleRequired = async (clientId: string, required: boolean) => {
    if (!selectedOrg) {
      alert("Please pick an org from the header before changing the requirement.");
      return;
    }
    try {
      await setRequirement(selectedOrg, clientId, required);
    } catch (err) {
      reportApiError("Could not update requirement", err);
    }
  };

  const uploadAll = async (reportUid: string, files: File[]) => {
    for (const f of files) {
      await uploadMonthlyReportAttachment(reportUid, f);
    }
  };

  const handleCreate = async (p: CreatePayload) => {
    try {
      const created = await createNew({
        client: p.client,
        year_month: p.year_month,
        report_date: p.report_date,
        report_name: p.report_name,
        key_points: p.key_points,
        assigned_manager: p.assigned_manager,
        ...(selectedOrg ? { org: selectedOrg } : {}),
      });
      if (p.newFiles.length) await uploadAll(created.uid, p.newFiles);
      if (p.submitImmediately) await submit(created.uid);
      setModalState({ mode: "closed" });
    } catch (err) {
      reportApiError("Save failed", err);
      throw err;
    }
  };

  const handleEdit = async (p: EditPayload) => {
    try {
      await editReport(p.reportUid, {
        report_name: p.report_name,
        report_date: p.report_date,
        key_points: p.key_points,
        assigned_manager: p.assigned_manager,
        year_month: p.year_month,
      });
      if (p.newFiles.length) await uploadAll(p.reportUid, p.newFiles);
      if (p.submitImmediately) await submit(p.reportUid);
      setModalState({ mode: "closed" });
    } catch (err) {
      reportApiError("Save failed", err);
      throw err;
    }
  };

  const onApprove = async (r: ClientMonthlyReportDto) => {
    const comment = prompt("Optional approval comment:") ?? "";
    try {
      await approve(r.uid, comment);
    } catch (err) {
      reportApiError("Approve failed", err);
    }
  };

  const onReject = async (r: ClientMonthlyReportDto) => {
    const comment = prompt("Reason for rejection (required):") ?? "";
    if (!comment.trim()) return;
    try {
      await reject(r.uid, comment.trim());
    } catch (err) {
      reportApiError("Reject failed", err);
    }
  };

  const onReview = async (r: ClientMonthlyReportDto) => {
    const comment = prompt("Optional review note:") ?? "";
    try {
      await review(r.uid, comment);
    } catch (err) {
      reportApiError("Review failed", err);
    }
  };

  const onSubmit = async (r: ClientMonthlyReportDto) => {
    try {
      await submit(r.uid);
    } catch (err) {
      reportApiError("Submit failed", err);
    }
  };

  const onDelete = async (r: ClientMonthlyReportDto) => {
    if (!confirm(`Delete the ${formatYM(r.year_month)} report for ${r.client_detail?.name ?? "this client"}?`)) return;
    try {
      await removeReport(r.uid);
    } catch (err) {
      reportApiError("Delete failed", err);
    }
  };

  const canFlagRequired = isAdminInAny() || isManagerInAny();

  return (
    <div>
      {/* Filter strip */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 10,
          marginBottom: 10,
          flexWrap: "wrap",
        }}
      >
        <label style={filterLabel}>
          AUDITS
          <select
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            style={filterInput}
          >
            <option value="">All audits</option>
            {monthOptions.map((m) => (
              <option key={m} value={m}>
                {formatYM(m)}
              </option>
            ))}
          </select>
        </label>
        <label style={filterLabel}>
          MONTH
          <input
            type="month"
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            style={filterInput}
          />
        </label>
        <label style={filterLabel}>
          DATE
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            style={filterInput}
          />
        </label>
        <MultiSelect
          label="Prepared by"
          options={profiles.map((p) => p.id)}
          selected={preparedByUids}
          onChange={setPreparedByUids}
          allLabel="All"
          labels={Object.fromEntries(profiles.map((p) => [p.id, p.full_name]))}
        />
        <MultiSelect
          label="Approving manager"
          options={profiles.map((p) => p.id)}
          selected={assignedManagerUids}
          onChange={setAssignedManagerUids}
          allLabel="All"
          labels={Object.fromEntries(profiles.map((p) => [p.id, p.full_name]))}
        />
        <MultiSelect
          label="Status"
          options={STATUSES as string[]}
          selected={statuses}
          onChange={setStatuses}
          allLabel="All"
        />
        <label style={checkLabel}>
          <input
            type="checkbox"
            checked={pendingMyApproval}
            onChange={(e) => setPendingMyApproval(e.target.checked)}
          />
          Pending my approval
        </label>
        <label style={checkLabel}>
          <input
            type="checkbox"
            checked={pendingMyReview}
            onChange={(e) => setPendingMyReview(e.target.checked)}
          />
          Pending my review
        </label>
        <label style={checkLabel}>
          <input
            type="checkbox"
            checked={hideNotRequired}
            onChange={(e) => setHideNotRequired(e.target.checked)}
          />
          Hide clients not flagged
        </label>
      </div>

      {/* Summary */}
      <div style={summaryRow}>
        <div style={{ ...summaryPill, background: "#eef2ff", color: "#3730a3" }}>
          📅 {monthFilter ? formatYM(monthFilter) : "All audits"}
          {dateFilter ? ` · ${dateFilter}` : ""}
        </div>
        <div style={summaryPill}>
          <strong>{summary.required}</strong> flagged required
        </div>
        <div style={{ ...summaryPill, background: "#f1f5f9" }}>
          <strong>{summary.drafted}</strong> drafted
        </div>
        <div style={{ ...summaryPill, background: "#fef3c7", color: "#92400e" }}>
          <strong>{summary.pending}</strong> pending approval
        </div>
        <div style={{ ...summaryPill, background: "#dbeafe", color: "#1e40af" }}>
          <strong>{summary.approved}</strong> awaiting review
        </div>
        <div style={{ ...summaryPill, background: "#dcfce7", color: "#166534" }}>
          <strong>{summary.reviewed}</strong> reviewed
        </div>
        {summary.rejected > 0 && (
          <div style={{ ...summaryPill, background: "#fee2e2", color: "#b91c1c" }}>
            <strong>{summary.rejected}</strong> rejected
          </div>
        )}
      </div>

      {/* Per-client rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
        {clientRows.length === 0 && (
          <div style={empty}>No clients match the current filters.</div>
        )}
        {clientRows.map(({ client, requirement, reports: cReports }) => {
          const isRequired = requirement?.required ?? false;
          const isOpen = openClients.has(client.id);
          return (
            <div key={client.id} style={clientCard}>
              <div style={clientHeader}>
                <button
                  type="button"
                  onClick={() => toggleClient(client.id)}
                  aria-expanded={isOpen}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flex: 1,
                    minWidth: 160,
                    textAlign: "left",
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                  }}
                >
                  <span style={{ width: 12, fontSize: 13 }}>{isOpen ? "▾" : "▸"}</span>
                  <span style={{ fontSize: 15, fontWeight: 700 }}>{client.name}</span>
                  <span style={{ fontSize: 12, color: "#64748b" }}>
                    ({cReports.length} report{cReports.length === 1 ? "" : "s"})
                  </span>
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 13,
                      fontWeight: 600,
                      color: isRequired ? "#166534" : "#64748b",
                      cursor: canFlagRequired ? "pointer" : "default",
                      opacity: canFlagRequired ? 1 : 0.6,
                    }}
                    title={
                      canFlagRequired
                        ? "Whether a monthly report is expected for this client every month — toggle once and it persists across months"
                        : "Only admins/managers can change this"
                    }
                  >
                    <input
                      type="checkbox"
                      disabled={!canFlagRequired}
                      checked={isRequired}
                      onChange={(e) => void onToggleRequired(client.id, e.target.checked)}
                    />
                    Report required
                  </label>
                  {isRequired && cReports.length === 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setModalState({
                          mode: "create",
                          defaultClientUid: client.id,
                          defaultYearMonth: monthFilter || currentYearMonth(),
                        })
                      }
                      style={primaryBtn}
                    >
                      + Add report
                    </button>
                  )}
                  {!isRequired && cReports.length === 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setModalState({
                          mode: "create",
                          defaultClientUid: client.id,
                          defaultYearMonth: monthFilter || currentYearMonth(),
                        })
                      }
                      style={ghostBtn}
                    >
                      + Add anyway
                    </button>
                  )}
                </div>
              </div>

              {isOpen && cReports.length === 0 && (
                <div style={{ marginTop: 8, fontSize: 13, color: "#64748b" }}>
                  No reports for this selection.
                </div>
              )}
              {isOpen && cReports.map((r) => (
                <ReportRow
                  key={r.uid}
                  report={r}
                  myUid={me}
                  isAdmin={isAdminIn(r.org_uid)}
                  onEdit={() => setModalState({ mode: "edit", report: r })}
                  onSubmit={() => void onSubmit(r)}
                  onApprove={() => void onApprove(r)}
                  onReject={() => void onReject(r)}
                  onReview={() => void onReview(r)}
                  onDelete={() => void onDelete(r)}
                />
              ))}
            </div>
          );
        })}
      </div>

      {modalState.mode === "create" && (
        <MonthlyReportModal
          mode="create"
          open
          defaultClientUid={modalState.defaultClientUid}
          defaultYearMonth={modalState.defaultYearMonth}
          clients={scopedClients}
          managers={profiles}
          onClose={() => setModalState({ mode: "closed" })}
          onSubmit={handleCreate}
        />
      )}
      {modalState.mode === "edit" && (
        <MonthlyReportModal
          mode="edit"
          open
          reportUid={modalState.report.uid}
          initialClientName={modalState.report.client_detail?.name ?? ""}
          initialReportName={modalState.report.report_name}
          initialReportDate={modalState.report.report_date}
          initialYearMonth={modalState.report.year_month}
          initialKeyPoints={modalState.report.key_points}
          initialManager={modalState.report.assigned_manager ?? ""}
          managers={profiles}
          existingAttachments={modalState.report.attachments}
          managerComment={
            modalState.report.status === "Rejected"
              ? modalState.report.manager_comment
              : ""
          }
          onClose={() => setModalState({ mode: "closed" })}
          onSubmit={handleEdit}
          onAttachmentDeleted={() => {
            // The websocket UPDATE event re-syncs reports.
          }}
        />
      )}
    </div>
  );
}

interface RowProps {
  report: ClientMonthlyReportDto;
  myUid: string;
  isAdmin: boolean;
  onEdit: () => void;
  onSubmit: () => void;
  onApprove: () => void;
  onReject: () => void;
  onReview: () => void;
  onDelete: () => void;
}

function ReportRow({
  report,
  myUid,
  isAdmin,
  onEdit,
  onSubmit,
  onApprove,
  onReject,
  onReview,
  onDelete,
}: RowProps) {
  const isAuthor = report.prepared_by === myUid;
  const isManager = report.assigned_manager === myUid;
  const colors = STATUS_COLORS[report.status];
  const canEdit = (isAuthor || isAdmin) && (report.status === "Draft" || report.status === "Rejected");
  const canSubmit = isAuthor && (report.status === "Draft" || report.status === "Rejected");
  const canApproveReject = (isManager || isAdmin) && report.status === "Pending";
  const canReview = isAdmin && report.status === "Approved";
  const canDelete = isAdmin || (isAuthor && report.status === "Draft");

  return (
    <div style={reportRow}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span
          style={{
            ...statusBadge,
            background: colors.bg,
            color: colors.fg,
          }}
        >
          {report.status}
        </span>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{report.report_name}</span>
        <span style={{ fontSize: 12, color: "#64748b" }}>
          📅 {report.report_date}
        </span>
        {report.prepared_by_detail && (
          <span style={metaPill}>By {report.prepared_by_detail.full_name}</span>
        )}
        {report.assigned_manager_detail && (
          <span style={metaPill}>👤 {report.assigned_manager_detail.full_name}</span>
        )}
        {report.attachments.length > 0 && (
          <span style={metaPill}>📎 {report.attachments.length}</span>
        )}
      </div>

      {report.key_points && (
        <div style={{ fontSize: 13, color: "#334155", whiteSpace: "pre-wrap", marginTop: 6 }}>
          {report.key_points}
        </div>
      )}

      {report.attachments.length > 0 && (
        <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {report.attachments.map((att) => (
            <button
              key={att.uid}
              type="button"
              onClick={() => void openAuthenticatedFile(att.download_url)}
              style={attBtn}
            >
              📎 {att.filename}
            </button>
          ))}
        </div>
      )}

      {report.manager_comment && (
        <div style={{ ...commentBlock, background: "#fef3c7", borderColor: "#fcd34d" }}>
          <strong>Manager:</strong> {report.manager_comment}
        </div>
      )}
      {report.review_comment && (
        <div style={{ ...commentBlock, background: "#dcfce7", borderColor: "#86efac" }}>
          <strong>Admin review:</strong> {report.review_comment}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        {canEdit && (
          <button type="button" onClick={onEdit} style={smallBtn}>
            Edit
          </button>
        )}
        {canSubmit && (
          <button type="button" onClick={onSubmit} style={smallPrimaryBtn}>
            Submit for approval
          </button>
        )}
        {canApproveReject && (
          <>
            <button type="button" onClick={onApprove} style={smallSuccessBtn}>
              Approve
            </button>
            <button type="button" onClick={onReject} style={smallDangerBtn}>
              Reject
            </button>
          </>
        )}
        {canReview && (
          <button type="button" onClick={onReview} style={smallPrimaryBtn}>
            Mark Reviewed
          </button>
        )}
        {canDelete && (
          <button type="button" onClick={onDelete} style={{ ...smallBtn, color: "#b91c1c" }}>
            Delete
          </button>
        )}
      </div>

      {report.audit_events.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: "pointer", fontSize: 12, color: "#64748b" }}>
            Timeline ({report.audit_events.length})
          </summary>
          <ul style={{ fontSize: 12, color: "#475569", margin: "6px 0 0", paddingLeft: 20 }}>
            {report.audit_events.map((evt) => (
              <li key={evt.uid}>
                <strong>{evt.event_type}</strong>
                {evt.actor_detail ? ` by ${evt.actor_detail.full_name}` : ""}
                {evt.comment ? ` — ${evt.comment}` : ""}
                <span style={{ color: "#94a3b8" }}>
                  {" "}
                  · {new Date(evt.created_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const filterLabel: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 12,
  fontWeight: 600,
  color: "#475569",
};
const filterInput: React.CSSProperties = {
  padding: "6px 8px",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  fontSize: 13,
};
const checkLabel: React.CSSProperties = {
  fontSize: 13,
  display: "flex",
  alignItems: "center",
  gap: 6,
  paddingBottom: 6,
};
const summaryRow: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  alignItems: "center",
};
const summaryPill: React.CSSProperties = {
  padding: "4px 10px",
  background: "#f8fafc",
  borderRadius: 999,
  fontSize: 13,
  color: "#475569",
};
const empty: React.CSSProperties = {
  padding: 24,
  textAlign: "center",
  color: "#64748b",
  background: "#f8fafc",
  borderRadius: 8,
};
const clientCard: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  padding: 12,
};
const clientHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexWrap: "wrap",
  gap: 8,
};
const reportRow: React.CSSProperties = {
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  borderRadius: 6,
  padding: 10,
  marginTop: 8,
};
const statusBadge: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  padding: "2px 8px",
  borderRadius: 999,
  textTransform: "uppercase",
  letterSpacing: 0.4,
};
const metaPill: React.CSSProperties = {
  fontSize: 11,
  padding: "1px 6px",
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 999,
  color: "#475569",
};
const commentBlock: React.CSSProperties = {
  marginTop: 6,
  fontSize: 12,
  padding: "6px 8px",
  borderRadius: 6,
  border: "1px solid",
};
const attBtn: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #cbd5e1",
  borderRadius: 999,
  padding: "3px 10px",
  fontSize: 12,
  cursor: "pointer",
  color: "#1e40af",
};
const primaryBtn: React.CSSProperties = {
  padding: "6px 12px",
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
const ghostBtn: React.CSSProperties = {
  padding: "6px 12px",
  background: "transparent",
  color: "#64748b",
  border: "1px dashed #cbd5e1",
  borderRadius: 6,
  fontSize: 12,
  cursor: "pointer",
};
const smallBtn: React.CSSProperties = {
  padding: "4px 10px",
  background: "#f1f5f9",
  border: "1px solid #e2e8f0",
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};
const smallPrimaryBtn: React.CSSProperties = {
  ...smallBtn,
  background: "#2563eb",
  color: "#fff",
  border: "none",
};
const smallSuccessBtn: React.CSSProperties = {
  ...smallBtn,
  background: "#16a34a",
  color: "#fff",
  border: "none",
};
const smallDangerBtn: React.CSSProperties = {
  ...smallBtn,
  background: "#dc2626",
  color: "#fff",
  border: "none",
};
