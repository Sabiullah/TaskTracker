import { useCallback, useEffect, useState } from "react";
import {
  approveMonthlyReport,
  createMonthlyReport,
  deleteMonthlyReport,
  editMonthlyReport,
  listMonthlyReports,
  listMonthlyReportRequirements,
  rejectMonthlyReport,
  reviewMonthlyReport,
  submitMonthlyReport,
  upsertMonthlyReportRequirement,
  ws,
  type ListMonthlyReportsQuery,
  type ListRequirementsQuery,
} from "@/lib/api";
import type {
  ClientMonthlyReportCreateForm,
  ClientMonthlyReportDto,
  ClientMonthlyReportEditForm,
  MonthlyReportRequirementDto,
} from "@/types/api/monthlyReports";

export interface UseMonthlyReportsArgs {
  readonly year_month?: string;
}

export interface UseMonthlyReportsReturn {
  reports: ClientMonthlyReportDto[];
  requirements: MonthlyReportRequirementDto[];
  loading: boolean;
  reload: () => Promise<void>;
  createNew: (form: ClientMonthlyReportCreateForm) => Promise<ClientMonthlyReportDto>;
  editReport: (uid: string, form: ClientMonthlyReportEditForm) => Promise<ClientMonthlyReportDto>;
  removeReport: (uid: string) => Promise<void>;
  submit: (uid: string) => Promise<void>;
  approve: (uid: string, comment?: string) => Promise<void>;
  reject: (uid: string, comment: string) => Promise<void>;
  review: (uid: string, comment?: string) => Promise<void>;
  setRequirement: (
    org: string,
    client: string,
    year_month: string,
    required: boolean,
  ) => Promise<MonthlyReportRequirementDto>;
}

export function useMonthlyReports({
  year_month,
}: UseMonthlyReportsArgs = {}): UseMonthlyReportsReturn {
  const [reports, setReports] = useState<ClientMonthlyReportDto[]>([]);
  const [requirements, setRequirements] = useState<MonthlyReportRequirementDto[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const reportsQuery: ListMonthlyReportsQuery | undefined = year_month
      ? { year_month }
      : undefined;
    const reqsQuery: ListRequirementsQuery | undefined = year_month
      ? { year_month }
      : undefined;
    const [reportsList, reqsList] = await Promise.all([
      listMonthlyReports(reportsQuery),
      listMonthlyReportRequirements(reqsQuery),
    ]);
    setReports(reportsList);
    setRequirements(reqsList);
  }, [year_month]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await reload();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const unsubReports = ws.subscribe<ClientMonthlyReportDto>(
      "client-monthly-reports",
      (evt) => {
        if (evt.event === "INSERT" && evt.record) {
          const next = evt.record;
          if (year_month && next.year_month !== year_month) return;
          setReports((prev) =>
            prev.some((r) => r.uid === next.uid) ? prev : [next, ...prev],
          );
        } else if (evt.event === "UPDATE" && evt.record) {
          const next = evt.record;
          setReports((prev) => prev.map((r) => (r.uid === next.uid ? next : r)));
        } else if (evt.event === "DELETE" && evt.record) {
          const recId = (evt.record as { uid?: string }).uid;
          setReports((prev) => prev.filter((r) => r.uid !== recId));
        }
      },
    );

    const unsubReqs = ws.subscribe<MonthlyReportRequirementDto>(
      "monthly-report-requirements",
      (evt) => {
        if ((evt.event === "UPDATE" || evt.event === "INSERT") && evt.record) {
          const next = evt.record;
          if (year_month && next.year_month !== year_month) return;
          setRequirements((prev) => {
            const existing = prev.find((r) => r.uid === next.uid);
            if (existing) return prev.map((r) => (r.uid === next.uid ? next : r));
            return [next, ...prev];
          });
        }
      },
    );

    return () => {
      cancelled = true;
      unsubReports();
      unsubReqs();
    };
  }, [reload, year_month]);

  const createNew = async (form: ClientMonthlyReportCreateForm) => {
    const created = await createMonthlyReport(form);
    setReports((prev) => [created, ...prev]);
    return created;
  };

  const editReportFn = async (uid: string, form: ClientMonthlyReportEditForm) => {
    const updated = await editMonthlyReport(uid, form);
    setReports((prev) => prev.map((r) => (r.uid === uid ? updated : r)));
    return updated;
  };

  const removeReport = async (uid: string) => {
    await deleteMonthlyReport(uid);
    setReports((prev) => prev.filter((r) => r.uid !== uid));
  };

  const submit = async (uid: string) => {
    await submitMonthlyReport(uid);
    await reload();
  };

  const approve = async (uid: string, comment?: string) => {
    await approveMonthlyReport(uid, comment);
    await reload();
  };

  const reject = async (uid: string, comment: string) => {
    await rejectMonthlyReport(uid, comment);
    await reload();
  };

  const review = async (uid: string, comment?: string) => {
    await reviewMonthlyReport(uid, comment);
    await reload();
  };

  const setRequirement = async (
    org: string,
    client: string,
    ym: string,
    required: boolean,
  ) => {
    const updated = await upsertMonthlyReportRequirement({
      org,
      client,
      year_month: ym,
      required,
    });
    setRequirements((prev) => {
      const existing = prev.find((r) => r.uid === updated.uid);
      if (existing) return prev.map((r) => (r.uid === updated.uid ? updated : r));
      return [updated, ...prev];
    });
    return updated;
  };

  return {
    reports,
    requirements,
    loading,
    reload,
    createNew,
    editReport: editReportFn,
    removeReport,
    submit,
    approve,
    reject,
    review,
    setRequirement,
  };
}
