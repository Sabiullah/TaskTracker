import { useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useMasters } from "@/hooks/useMasters";
import { useClientVisits } from "@/hooks/useClientVisits";
import { uploadVisitReportAttachment } from "@/lib/api";
import MultiSelect from "@/components/ui/MultiSelect";
import ClientVisitGroupedView from "./ClientVisitGroupedView";
import VisitSubmitModal, {
  type SubmitModalCreatePayload,
  type SubmitModalEditPayload,
  type SubmitModalResubmitPayload,
} from "./VisitSubmitModal";
import { groupVisitsByClient } from "./internalReportGrouping";
import {
  isInternalReportFilterActive,
  visitMatches,
  type InternalReportFilters,
} from "./internalReportFilters";
import { reportApiError } from "./errors";
import type { Profile } from "@/types/auth";
import type {
  VisitReportAttachmentDto,
  VisitStatus,
} from "@/types/api/internalReports";

interface Props {
  clientUid: string;
  selectedOrg: string | null;
  profile: Profile | null;
  profiles: Profile[];
}

const STATUSES: VisitStatus[] = ["Draft", "Pending", "Approved", "Rejected"];

export default function ClientInternalReportTab({
  clientUid,
  selectedOrg,
  profile,
  profiles,
}: Props) {
  const { isAdminInAny } = useAuth();
  const { clients } = useMasters();
  const isOrgAdmin = isAdminInAny();
  const me = profile?.id ?? "";

  const {
    visits,
    loading,
    createNew,
    editDraft,
    submit,
    approve,
    reject,
    resubmit,
    setSentInfo,
  } = useClientVisits();

  const [preparedByUids, setPreparedByUids] = useState<string[]>([]);
  const [assignedManagerUids, setAssignedManagerUids] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [visitMonth, setVisitMonth] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [pendingMyApproval, setPendingMyApproval] = useState(false);

  const [modalState, setModalState] = useState<
    | { mode: "closed" }
    | { mode: "create"; defaultClientUid: string }
    | { mode: "edit"; reportUid: string; initialKeyPoints: string }
    | { mode: "resubmit"; reportUid: string; priorKeyPoints: string; managerComment: string }
  >({ mode: "closed" });

  const filters: InternalReportFilters = useMemo(
    () => ({
      preparedByUids,
      assignedManagerUids: pendingMyApproval && me ? [me] : assignedManagerUids,
      statuses: pendingMyApproval ? ["Pending"] : statuses,
      visitMonth,
      overdueOnly,
    }),
    [preparedByUids, assignedManagerUids, statuses, visitMonth, overdueOnly, pendingMyApproval, me],
  );

  const filteredVisits = useMemo(() => {
    let list = visits;
    if (clientUid) list = list.filter((v) => v.client === clientUid);
    if (selectedOrg) list = list.filter((v) => v.org_uid === selectedOrg);
    return isInternalReportFilterActive(filters)
      ? list.filter((v) => visitMatches(v, filters))
      : list;
  }, [visits, clientUid, selectedOrg, filters]);

  const groups = useMemo(() => groupVisitsByClient(filteredVisits), [filteredVisits]);

  if (loading) return <div>Loading…</div>;

  const onAddVisit = (clientUidForRow: string) => {
    setModalState({ mode: "create", defaultClientUid: clientUidForRow || clientUid });
  };

  const uploadAll = async (reportUid: string, files: File[]) => {
    for (const f of files) {
      await uploadVisitReportAttachment(reportUid, f);
    }
  };

  const handleCreate = async (p: SubmitModalCreatePayload) => {
    try {
      const created = await createNew({
        client: p.client,
        visit_date: p.visit_date,
        assigned_manager: p.assigned_manager,
        key_points: p.key_points,
        // ``selectedOrg`` is the org currently chosen in the header pill. The
        // backend's ``resolve_create_org`` requires an explicit ``org`` whenever
        // the caller belongs to more than one — without this the create POST
        // 400s with ``org is required (you belong to multiple organisations)``.
        ...(selectedOrg ? { org: selectedOrg } : {}),
      });
      const reportUid = created.reports[0]?.uid;
      if (reportUid) await uploadAll(reportUid, p.newFiles);
      if (p.submitImmediately && reportUid) {
        await submit(reportUid);
      }
      setModalState({ mode: "closed" });
    } catch (err) {
      reportApiError("Save failed", err);
      throw err;
    }
  };

  const handleEdit = async (p: SubmitModalEditPayload) => {
    try {
      await editDraft(p.reportUid, { key_points: p.key_points });
      await uploadAll(p.reportUid, p.newFiles);
      if (p.submitImmediately) await submit(p.reportUid);
      setModalState({ mode: "closed" });
    } catch (err) {
      reportApiError("Save failed", err);
      throw err;
    }
  };

  const handleResubmit = async (p: SubmitModalResubmitPayload) => {
    try {
      const newReport = await resubmit(p.reportUid, { key_points: p.key_points });
      await uploadAll(newReport.uid, p.newFiles);
      // Mirror today's behaviour: resubmit always auto-submits the new revision.
      await submit(newReport.uid);
      setModalState({ mode: "closed" });
    } catch (err) {
      reportApiError("Save failed", err);
      throw err;
    }
  };

  const existingAttachmentsFor = (reportUid: string): readonly VisitReportAttachmentDto[] => {
    for (const v of visits) {
      const r = v.reports.find((rep) => rep.uid === reportUid);
      if (r) return r.attachments;
    }
    return [];
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 10,
          marginBottom: 10,
          flexWrap: "wrap",
        }}
      >
        <MultiSelect
          label="Prepared by"
          options={profiles.map((p) => p.id)}
          selected={preparedByUids}
          onChange={setPreparedByUids}
          allLabel="All"
          labels={Object.fromEntries(profiles.map((p) => [p.id, p.full_name]))}
        />
        <MultiSelect
          label="Assigned manager"
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
        <label
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            fontSize: 12,
            fontWeight: 600,
            color: "#475569",
          }}
        >
          VISIT MONTH
          <input
            type="month"
            value={visitMonth}
            onChange={(e) => setVisitMonth(e.target.value)}
            style={{
              padding: "6px 8px",
              border: "1px solid #cbd5e1",
              borderRadius: 6,
              fontSize: 13,
            }}
          />
        </label>
        <label
          style={{
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            gap: 6,
            paddingBottom: 6,
          }}
        >
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(e) => setOverdueOnly(e.target.checked)}
          />
          Overdue only
        </label>
        <label
          style={{
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            gap: 6,
            paddingBottom: 6,
          }}
        >
          <input
            type="checkbox"
            checked={pendingMyApproval}
            onChange={(e) => setPendingMyApproval(e.target.checked)}
          />
          Pending my approval
        </label>
        <button
          type="button"
          onClick={() => setModalState({ mode: "create", defaultClientUid: clientUid })}
          style={{
            marginLeft: "auto",
            padding: "8px 14px",
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          + New Visit
        </button>
      </div>

      <ClientVisitGroupedView
        groups={groups}
        currentUserUid={me}
        isOrgAdmin={isOrgAdmin}
        onAddVisit={onAddVisit}
        onEditDraft={(reportUid, initialKeyPoints) =>
          setModalState({ mode: "edit", reportUid, initialKeyPoints })
        }
        onSubmit={submit}
        onApprove={approve}
        onReject={reject}
        onResubmit={(reportUid, priorKeyPoints, managerComment) =>
          setModalState({ mode: "resubmit", reportUid, priorKeyPoints, managerComment })
        }
        onSetSentInfo={async (uid, form) => {
          await setSentInfo(uid, form);
        }}
      />

      {modalState.mode === "create" && (
        <VisitSubmitModal
          mode="create"
          open
          defaultClientUid={modalState.defaultClientUid}
          clients={clients}
          managers={profiles}
          onClose={() => setModalState({ mode: "closed" })}
          onSubmit={handleCreate}
        />
      )}
      {modalState.mode === "edit" && (
        <VisitSubmitModal
          mode="edit"
          open
          reportUid={modalState.reportUid}
          initialKeyPoints={modalState.initialKeyPoints}
          existingAttachments={existingAttachmentsFor(modalState.reportUid)}
          onClose={() => setModalState({ mode: "closed" })}
          onSubmit={handleEdit}
          onAttachmentDeleted={() => {
            // The websocket UPDATE event re-syncs visits; nothing else to do.
          }}
        />
      )}
      {modalState.mode === "resubmit" && (
        <VisitSubmitModal
          mode="resubmit"
          open
          reportUid={modalState.reportUid}
          priorKeyPoints={modalState.priorKeyPoints}
          managerComment={modalState.managerComment}
          existingAttachments={existingAttachmentsFor(modalState.reportUid)}
          onClose={() => setModalState({ mode: "closed" })}
          onSubmit={handleResubmit}
          onAttachmentDeleted={() => {
            // Same reasoning as edit mode.
          }}
        />
      )}
    </div>
  );
}
