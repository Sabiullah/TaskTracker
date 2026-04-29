/**
 * Public surface of the Django REST API client.
 *
 * Import from `@/lib/api` in hooks and data-access layers. Components and
 * pages should not reach into the individual files — the barrel keeps the
 * module boundary explicit.
 */

export {
  ApiError,
  API_BASE,
  apiDelete,
  apiGet,
  apiPatch,
  apiPatchForm,
  apiPost,
  apiPostForm,
  apiPut,
  apiRequest,
  openAuthenticatedFile,
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setTokens,
  type RequestOptions,
  type RequestQuery,
} from "./client";

export { login, logout, me } from "./auth";

export { ws, WS_URL, type RealtimeHandler } from "./ws";

export {
  attendanceToCreate,
  dtoToAttendance,
  dtoToAuthUser,
  dtoToLead,
  dtoToLeaveRequest,
  dtoToProfile,
  dtoToTask,
  dtoToWorkLog,
  dtoToWorkPlan,
  leadToCreate,
  taskToCreate,
  workLogToCreate,
  workPlanToCreate,
  type LeadWriteRefs,
  type TaskWriteRefs,
  type WorkLogWriteRefs,
  type WorkPlanWriteRefs,
} from "./mappers";

export {
  approveReport,
  createVisit,
  deleteVisit,
  deleteVisitReportAttachment,
  editReport,
  getVisit,
  listAuditEvents,
  listVisits,
  rejectReport,
  resubmitReport,
  submitReport,
  updateSentInfo,
  uploadVisitReportAttachment,
  type ListVisitsQuery,
} from "./internalReports";

export { toast, type ToastKind } from "../toast";
