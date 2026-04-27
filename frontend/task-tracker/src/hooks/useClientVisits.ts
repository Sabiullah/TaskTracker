import { useCallback, useEffect, useState } from "react";
import {
  approveReport,
  createVisit,
  deleteVisit,
  editReport,
  listVisits,
  rejectReport,
  resubmitReport,
  submitReport,
  updateSentInfo,
  ws,
  type ListVisitsQuery,
} from "@/lib/api";
import type {
  ClientVisitCreateForm,
  ClientVisitDto,
  VisitReportEditForm,
  VisitSentInfoForm,
} from "@/types/api/internalReports";

export interface UseClientVisitsReturn {
  visits: ClientVisitDto[];
  loading: boolean;
  reload: (q?: ListVisitsQuery) => Promise<void>;
  createNew: (form: ClientVisitCreateForm) => Promise<ClientVisitDto>;
  removeVisit: (uid: string) => Promise<void>;
  setSentInfo: (uid: string, form: VisitSentInfoForm) => Promise<ClientVisitDto>;
  editDraft: (reportUid: string, form: VisitReportEditForm) => Promise<void>;
  submit: (reportUid: string) => Promise<void>;
  approve: (reportUid: string) => Promise<void>;
  reject: (reportUid: string, comment: string) => Promise<void>;
  resubmit: (reportUid: string, form: VisitReportEditForm) => Promise<void>;
}

export function useClientVisits(initialQuery?: ListVisitsQuery): UseClientVisitsReturn {
  const [visits, setVisits] = useState<ClientVisitDto[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (q?: ListVisitsQuery) => {
    const data = await listVisits(q ?? initialQuery);
    setVisits(data);
  }, [initialQuery]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await reload();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    // INSERT/UPDATE/DELETE on visits — patch the local list when we have it.
    const unsubVisits = ws.subscribe<ClientVisitDto>("client-visits", (evt) => {
      if (evt.event === "INSERT" && evt.record) {
        const next = evt.record;
        setVisits((prev) => (prev.some((v) => v.uid === next.uid) ? prev : [next, ...prev]));
      } else if (evt.event === "UPDATE" && evt.record) {
        const next = evt.record;
        setVisits((prev) => prev.map((v) => (v.uid === next.uid ? next : v)));
      } else if (evt.event === "DELETE" && evt.record) {
        const recId = (evt.record as { uid?: string }).uid;
        setVisits((prev) => prev.filter((v) => v.uid !== recId));
      }
    });
    // visit-reports updates: mutate the embedded report inside the parent visit
    // we already hold; if we don't hold it, refetch the list.
    const unsubReports = ws.subscribe<{ uid: string; visit: number }>("visit-reports", () => {
      void reload();
    });

    return () => {
      cancelled = true;
      unsubVisits();
      unsubReports();
    };
  }, [reload]);

  const createNew = async (form: ClientVisitCreateForm) => {
    const created = await createVisit(form);
    setVisits((prev) => [created, ...prev]);
    return created;
  };

  const removeVisit = async (uid: string) => {
    await deleteVisit(uid);
    setVisits((prev) => prev.filter((v) => v.uid !== uid));
  };

  const setSentInfo = async (uid: string, form: VisitSentInfoForm) => {
    const updated = await updateSentInfo(uid, form);
    setVisits((prev) => prev.map((v) => (v.uid === uid ? updated : v)));
    return updated;
  };

  const editDraft = async (reportUid: string, form: VisitReportEditForm) => {
    await editReport(reportUid, form);
    await reload();
  };
  const submit = async (reportUid: string) => {
    await submitReport(reportUid);
    await reload();
  };
  const approve = async (reportUid: string) => {
    await approveReport(reportUid);
    await reload();
  };
  const reject = async (reportUid: string, comment: string) => {
    await rejectReport(reportUid, comment);
    await reload();
  };
  const resubmit = async (reportUid: string, form: VisitReportEditForm) => {
    await resubmitReport(reportUid, form);
    await reload();
  };

  return {
    visits,
    loading,
    reload,
    createNew,
    removeVisit,
    setSentInfo,
    editDraft,
    submit,
    approve,
    reject,
    resubmit,
  };
}
