import { apiGet, apiPatch, apiPost, apiRequest } from "./client";
import type {
  MonthScopedTaskDto,
  PlanAddRequest,
  PlanAddResponse,
  PlanCapResponse,
  TaskDto,
} from "@/types/api";

/** GET /api/tasks/<uid>/?month=YYYY-MM
 *
 * Returns the task with its month-scoped subtask children + the plan
 * recurrence metadata used by the modal.
 */
export function fetchTaskWithMonth(
  taskUid: string,
  yearMonth: string,
): Promise<MonthScopedTaskDto> {
  return apiGet<MonthScopedTaskDto>(`/tasks/${taskUid}/`, { month: yearMonth });
}

/** POST /api/tasks/<uid>/plans/
 *
 * Adds a subcategory plan to a parent task. The server may also create
 * a child task for the supplied month (returned in `child`).
 */
export function addPlan(
  taskUid: string,
  body: PlanAddRequest,
): Promise<PlanAddResponse> {
  return apiPost<PlanAddResponse>(`/tasks/${taskUid}/plans/`, body);
}

/** DELETE /api/tasks/<uid>/plans/<plan_uid>/?from_month=YYYY-MM
 *
 * Caps an active plan at `from_month` (or fully deletes it if `from_month`
 * is the activation month). The shared `apiDelete` helper discards the
 * response body, so we go through `apiRequest` directly to keep the
 * server's `PlanCapResponse` payload.
 */
export function removePlan(
  taskUid: string,
  planUid: string,
  fromMonth: string,
): Promise<PlanCapResponse> {
  return apiRequest<PlanCapResponse>(`/tasks/${taskUid}/plans/${planUid}/`, {
    method: "DELETE",
    query: { from_month: fromMonth },
  });
}

/** PATCH /api/tasks/<uid>/?cascade_owner=true
 *
 * Updates a child task's `responsible` and cascades the same owner change
 * to all sibling children that inherit from the same plan.
 */
export function patchSubtaskCascadeOwner(
  childUid: string,
  newOwnerUid: string,
): Promise<TaskDto> {
  return apiPatch<TaskDto>(
    `/tasks/${childUid}/`,
    { responsible: newOwnerUid },
    { cascade_owner: true },
  );
}
