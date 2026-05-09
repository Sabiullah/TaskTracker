import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPostForm,
  type RequestQuery,
} from "./client";
import type {
  ClientMonthlyReportCreateForm,
  ClientMonthlyReportDto,
  ClientMonthlyReportEditForm,
  MonthlyReportAttachmentDto,
  MonthlyReportRequirementDto,
  MonthlyReportRequirementUpsertForm,
} from "@/types/api/monthlyReports";

export interface ListMonthlyReportsQuery extends RequestQuery {
  client_uid?: string;
  prepared_by_uid?: string | readonly string[];
  assigned_manager_uid?: string | readonly string[];
  status?: string | readonly string[];
  year_month?: string;
  org?: string;
}

export const listMonthlyReports = (query?: ListMonthlyReportsQuery) =>
  apiGet<ClientMonthlyReportDto[]>("/client-monthly-reports/", query);

export const createMonthlyReport = (form: ClientMonthlyReportCreateForm) =>
  apiPost<ClientMonthlyReportDto>("/client-monthly-reports/", form);

export const editMonthlyReport = (uid: string, form: ClientMonthlyReportEditForm) =>
  apiPatch<ClientMonthlyReportDto>(`/client-monthly-reports/${uid}/`, form);

export const deleteMonthlyReport = (uid: string) =>
  apiDelete(`/client-monthly-reports/${uid}/`);

export const submitMonthlyReport = (uid: string) =>
  apiPost<ClientMonthlyReportDto>(`/client-monthly-reports/${uid}/submit/`, {});

export const approveMonthlyReport = (uid: string, manager_comment?: string) =>
  apiPost<ClientMonthlyReportDto>(`/client-monthly-reports/${uid}/approve/`, {
    manager_comment: manager_comment ?? "",
  });

export const rejectMonthlyReport = (uid: string, manager_comment: string) =>
  apiPost<ClientMonthlyReportDto>(`/client-monthly-reports/${uid}/reject/`, {
    manager_comment,
  });

export const reviewMonthlyReport = (uid: string, review_comment?: string) =>
  apiPost<ClientMonthlyReportDto>(`/client-monthly-reports/${uid}/review/`, {
    review_comment: review_comment ?? "",
  });

export function uploadMonthlyReportAttachment(
  reportUid: string,
  file: File,
): Promise<MonthlyReportAttachmentDto> {
  const fd = new FormData();
  fd.append("file", file);
  return apiPostForm<MonthlyReportAttachmentDto>(
    `/client-monthly-reports/${reportUid}/attachments/`,
    fd,
  );
}

export const deleteMonthlyReportAttachment = (attachmentUid: string) =>
  apiDelete(`/monthly-report-attachments/${attachmentUid}/`);

// Requirement flag (per org+client "report required: yes/no" — persistent
// across months).
export interface ListRequirementsQuery extends RequestQuery {
  org?: string;
  client_uid?: string;
}

export const listMonthlyReportRequirements = (query?: ListRequirementsQuery) =>
  apiGet<MonthlyReportRequirementDto[]>("/monthly-report-requirements/", query);

export const upsertMonthlyReportRequirement = (
  form: MonthlyReportRequirementUpsertForm,
) =>
  apiPost<MonthlyReportRequirementDto>(
    "/monthly-report-requirements/upsert/",
    form,
  );
