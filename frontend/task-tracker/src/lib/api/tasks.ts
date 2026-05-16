import { apiGet, apiPatch, apiPost, apiRequest } from "./client";
import type {
  MasterRecurrence,
  MonthScopedTaskDto,
  PlanAddRequest,
  PlanAddResponse,
  PlanCapResponse,
  TaskDto,
  TaskSubcategoryPlanDto,
} from "@/types/api";

/** Response from `PATCH /api/tasks/<uid>/plans/<plan_uid>/`. */
export interface PlanRecurrenceUpdateResponse {
  readonly plan: TaskSubcategoryPlanDto;
  readonly children_deleted: number;
  readonly deleted_child_uids: readonly string[];
  readonly children_created: number;
  readonly created_child_uids: readonly string[];
}

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

/** PATCH /api/tasks/<uid>/plans/<plan_uid>/?from_month=YYYY-MM
 *
 * Changes the plan's recurrence (and optionally target_day) and
 * re-materialises future months on the new cadence. Past completed
 * children are preserved as history; future open children are deleted
 * then regenerated. ``newTargetDay`` is needed when the recurrence
 * change crosses the weekly ↔ monthly boundary: 1-7 means a weekday for
 * weekly plans and a day-of-month for everything else, so the cadence
 * day must travel with the recurrence change to avoid an off-day plan.
 */
export function patchPlanRecurrence(
  taskUid: string,
  planUid: string,
  fromMonth: string,
  newRecurrence: MasterRecurrence,
  newTargetDay?: number | null,
): Promise<PlanRecurrenceUpdateResponse> {
  const body: { recurrence: MasterRecurrence; target_day?: number | null } = {
    recurrence: newRecurrence,
  };
  if (newTargetDay !== undefined) {
    body.target_day = newTargetDay;
  }
  return apiRequest<PlanRecurrenceUpdateResponse>(
    `/tasks/${taskUid}/plans/${planUid}/`,
    {
      method: "PATCH",
      query: { from_month: fromMonth },
      body,
    },
  );
}
