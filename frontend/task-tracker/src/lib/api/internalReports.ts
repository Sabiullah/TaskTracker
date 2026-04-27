import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPatchForm,
  apiPost,
  apiPostForm,
  type RequestQuery,
} from "./client";
import type {
  ClientVisitDto,
  ClientVisitCreateForm,
  VisitReportDto,
  VisitReportAuditEventDto,
  VisitReportEditForm,
  VisitSentInfoForm,
} from "@/types/api/internalReports";

export interface ListVisitsQuery extends RequestQuery {
  client_uid?: string;
  /** Multi-value: emitted as repeated ``?prepared_by_uid=X&prepared_by_uid=Y`` so
   * the backend's ``request.query_params.getlist("prepared_by_uid")`` returns
   * each value distinctly. */
  prepared_by_uid?: string | readonly string[];
  /** Multi-value (see prepared_by_uid). */
  assigned_manager_uid?: string | readonly string[];
  /** Multi-value (see prepared_by_uid). */
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

export const createVisit = (form: ClientVisitCreateForm) => {
  const fd = new FormData();
  fd.append("client", form.client);
  fd.append("visit_date", form.visit_date);
  fd.append("assigned_manager", form.assigned_manager);
  fd.append("key_points", form.key_points);
  if (form.observation_attachment) {
    fd.append("observation_attachment", form.observation_attachment);
  }
  if (form.org) fd.append("org", form.org);
  return apiPostForm<ClientVisitDto>("/client-visits/", fd);
};

export const deleteVisit = (uid: string) => apiDelete(`/client-visits/${uid}/`);

export const updateSentInfo = (uid: string, form: VisitSentInfoForm) =>
  apiPatch<ClientVisitDto>(`/client-visits/${uid}/sent-info/`, form);

export const editReport = (uid: string, form: VisitReportEditForm) => {
  const fd = new FormData();
  if (form.key_points !== undefined) fd.append("key_points", form.key_points);
  if (form.observation_attachment) {
    fd.append("observation_attachment", form.observation_attachment);
  }
  return apiPatchForm<VisitReportDto>(`/visit-reports/${uid}/`, fd);
};

export const submitReport = (uid: string) =>
  apiPost<VisitReportDto>(`/visit-reports/${uid}/submit/`, {});

export const approveReport = (uid: string) =>
  apiPost<VisitReportDto>(`/visit-reports/${uid}/approve/`, {});

export const rejectReport = (uid: string, manager_comment: string) =>
  apiPost<VisitReportDto>(`/visit-reports/${uid}/reject/`, { manager_comment });

export const resubmitReport = (uid: string, form: VisitReportEditForm) => {
  const fd = new FormData();
  if (form.key_points !== undefined) fd.append("key_points", form.key_points);
  if (form.observation_attachment) {
    fd.append("observation_attachment", form.observation_attachment);
  }
  return apiPostForm<VisitReportDto>(`/visit-reports/${uid}/resubmit/`, fd);
};

export const listAuditEvents = (visit_uid: string) =>
  apiGet<VisitReportAuditEventDto[]>("/visit-audit-events/", { visit_uid });
