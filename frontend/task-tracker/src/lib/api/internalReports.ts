import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPostForm,
  type RequestQuery,
} from "./client";
import type {
  ClientVisitDto,
  ClientVisitCreateForm,
  VisitReportAttachmentDto,
  VisitReportDto,
  VisitReportAuditEventDto,
  VisitReportEditForm,
  VisitSentInfoForm,
} from "@/types/api/internalReports";

export interface ListVisitsQuery extends RequestQuery {
  client_uid?: string;
  prepared_by_uid?: string | readonly string[];
  assigned_manager_uid?: string | readonly string[];
  status?: string | readonly string[];
  visit_month?: string;
  date_from?: string;
  date_to?: string;
  overdue?: "true";
}

export const listVisits = (query?: ListVisitsQuery) =>
  apiGet<ClientVisitDto[]>("/client-visits/", query);

export const getVisit = (uid: string) =>
  apiGet<ClientVisitDto>(`/client-visits/${uid}/`);

export const createVisit = (form: ClientVisitCreateForm) =>
  apiPost<ClientVisitDto>("/client-visits/", form);

export const deleteVisit = (uid: string) => apiDelete(`/client-visits/${uid}/`);

export const updateSentInfo = (uid: string, form: VisitSentInfoForm) =>
  apiPatch<ClientVisitDto>(`/client-visits/${uid}/sent-info/`, form);

export const editReport = (uid: string, form: VisitReportEditForm) =>
  apiPatch<VisitReportDto>(`/visit-reports/${uid}/`, form);

export const submitReport = (uid: string) =>
  apiPost<VisitReportDto>(`/visit-reports/${uid}/submit/`, {});

export const approveReport = (uid: string) =>
  apiPost<VisitReportDto>(`/visit-reports/${uid}/approve/`, {});

export const rejectReport = (uid: string, manager_comment: string) =>
  apiPost<VisitReportDto>(`/visit-reports/${uid}/reject/`, { manager_comment });

export const resubmitReport = (uid: string, form: VisitReportEditForm) =>
  apiPost<VisitReportDto>(`/visit-reports/${uid}/resubmit/`, form);

export const listAuditEvents = (visit_uid: string) =>
  apiGet<VisitReportAuditEventDto[]>("/visit-audit-events/", { visit_uid });

export function uploadVisitReportAttachment(
  reportUid: string,
  file: File,
): Promise<VisitReportAttachmentDto> {
  const fd = new FormData();
  fd.append("file", file);
  return apiPostForm<VisitReportAttachmentDto>(
    `/visit-reports/${reportUid}/attachments/`,
    fd,
  );
}

export const deleteVisitReportAttachment = (attachmentUid: string) =>
  apiDelete(`/visit-report-attachments/${attachmentUid}/`);
