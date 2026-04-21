import type {
  AttendanceCreate,
  AttendanceDto,
  AttendanceStatusValue,
  LeadCreate,
  LeadDto,
  ProfileDto,
  TaskCreate,
  TaskDto,
  TaskRecurrenceValue,
  TaskStatusValue,
  WorkLocationValue,
  WorkLogCreate,
  WorkLogDto,
  WorkPlanCreate,
  WorkPlanDto,
  WorkLogPriorityValue,
} from "@/types/api";
import type {
  AttendanceRecord,
  AuthUser,
  Lead,
  Profile,
  Task,
  TaskStatus,
  RecurrenceType,
  WorkLog,
  WorkPlan,
} from "@/types";
import {
  packAttendanceForServer,
  unpackAttendanceFromServer,
} from "@/utils/attendance";
import { decimalToHours, hoursToDecimal } from "@/utils/hours";
import { getDayName } from "@/utils/date";

// ─── Profile / AuthUser ──────────────────────────────────────────────────────

export function dtoToProfile(dto: ProfileDto): Profile {
  // Keep the readonly shape Django returns; callers treat ``orgs`` as
  // immutable and read only — they don't mutate the array.
  return {
    id: dto.uid,
    username: dto.username,
    email: dto.email,
    full_name: dto.full_name,
    manager_ids: dto.manager_ids.length ? [...dto.manager_ids] : null,
    avatar_color: dto.avatar_color || null,
    orgs: dto.orgs,
    highest_role: dto.highest_role,
  };
}

export function dtoToAuthUser(dto: ProfileDto): AuthUser {
  return {
    id: dto.uid,
    email: dto.email,
    username: dto.username,
  };
}

// ─── Task ────────────────────────────────────────────────────────────────────

const TASK_STATUS_DTO_TO_DOMAIN: Readonly<Record<TaskStatusValue, TaskStatus>> =
  {
    pending: "Pending",
    today_task: "TodayTask",
    tomorrow: "Tomorrow",
    in_progress: "Pending",
    completed: "Completed",
    completed_delay: "Completed Delay",
    overdue: "Overdue",
    future_goal: "Future Task/Goals",
    tbc: "TBC",
    archived: "Completed",
  };

const TASK_STATUS_DOMAIN_TO_DTO: Readonly<Record<TaskStatus, TaskStatusValue>> =
  {
    "Future Task/Goals": "future_goal",
    TBC: "tbc",
    Pending: "pending",
    Tomorrow: "tomorrow",
    TodayTask: "today_task",
    Overdue: "overdue",
    Ontime: "completed",
    Completed: "completed",
    "Completed Delay": "completed_delay",
  };

const RECURRENCE_DTO_TO_DOMAIN: Readonly<
  Record<TaskRecurrenceValue, RecurrenceType>
> = {
  onetime: "Onetime",
  daily: "Onetime",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  halfyearly: "Halfyearly",
  yearly: "Yearly",
};

const RECURRENCE_DOMAIN_TO_DTO: Readonly<
  Record<RecurrenceType, TaskRecurrenceValue>
> = {
  Onetime: "onetime",
  Weekly: "weekly",
  Monthly: "monthly",
  Quarterly: "quarterly",
  Halfyearly: "halfyearly",
  Yearly: "yearly",
};

export function dtoToTask(dto: TaskDto): Task {
  return {
    id: dto.uid,
    serialNo: dto.serial_no,
    client: dto.client_detail?.name ?? "",
    category: dto.category_detail?.name ?? "",
    description: dto.description,
    status: TASK_STATUS_DTO_TO_DOMAIN[dto.status] ?? "Pending",
    targetDate: dto.target_date ?? "",
    expectedDate: dto.expected_date ?? "",
    completedDate: dto.completed_date ?? "",
    responsible: dto.responsible_detail?.full_name ?? "",
    remarks: dto.remarks,
    recurrence: RECURRENCE_DTO_TO_DOMAIN[dto.recurrence] ?? "Onetime",
    organization: dto.org_uid,
    createdBy: dto.created_by_detail?.uid ?? null,
    createdAt: dto.created_at,
  };
}

/**
 * Domain → create/update payload. FK fields (`client`, `category`, `responsible`,
 * `org`) must be set by the caller because the domain model carries display
 * names, not uids.
 */
export interface TaskWriteRefs {
  readonly client?: string;
  readonly category?: string;
  readonly responsible?: string;
  readonly org?: string;
}

export function taskToCreate(task: Task, refs: TaskWriteRefs = {}): TaskCreate {
  return {
    description: task.description,
    status: TASK_STATUS_DOMAIN_TO_DTO[task.status],
    recurrence: RECURRENCE_DOMAIN_TO_DTO[task.recurrence] ?? "onetime",
    target_date: task.targetDate || undefined,
    expected_date: task.expectedDate || undefined,
    completed_date: task.completedDate || undefined,
    remarks: task.remarks,
    client: refs.client ?? undefined,
    category: refs.category ?? undefined,
    responsible: refs.responsible ?? undefined,
    org: refs.org ?? task.organization ?? undefined,
  };
}

// ─── WorkLog ─────────────────────────────────────────────────────────────────

export function dtoToWorkLog(dto: WorkLogDto): WorkLog {
  return {
    id: dto.uid,
    name: dto.user_detail.full_name,
    date: dto.date,
    // Backend doesn't store the weekday — derive it here so the table's
    // "Day" column is populated immediately on load instead of waiting for
    // an inline edit to recompute.
    day: getDayName(dto.date),
    client: dto.client_detail?.name ?? "",
    task_description: dto.task_description,
    hours_worked: decimalToHours(dto.hours_worked),
    priority: dto.priority,
    organization: dto.org_uid,
    sort_order: dto.sort_order,
  };
}

export interface WorkLogWriteRefs {
  readonly client?: string;
  readonly org?: string;
}

export function workLogToCreate(
  log: WorkLog,
  refs: WorkLogWriteRefs = {},
): WorkLogCreate {
  return {
    date: log.date,
    task_description: log.task_description,
    hours_worked: hoursToDecimal(log.hours_worked),
    priority: (log.priority as WorkLogPriorityValue) || "Normal",
    sort_order: log.sort_order ?? undefined,
    client: refs.client ?? undefined,
    org: refs.org ?? log.organization ?? undefined,
  };
}

// ─── WorkPlan ────────────────────────────────────────────────────────────────

export function dtoToWorkPlan(dto: WorkPlanDto): WorkPlan {
  return {
    id: dto.uid,
    user_id: dto.assigned_to_detail.uid,
    name: dto.assigned_to_detail.full_name,
    date: dto.date,
    day: getDayName(dto.date),
    client: dto.client_detail?.name ?? "",
    task_description: dto.task_description,
    hours_planned: decimalToHours(dto.planned_hours),
    priority: "Normal",
    organization: dto.org_uid,
    sort_order: null,
  };
}

export interface WorkPlanWriteRefs {
  readonly client?: string;
  readonly org?: string;
}

export function workPlanToCreate(
  plan: WorkPlan,
  refs: WorkPlanWriteRefs = {},
): WorkPlanCreate {
  return {
    assigned_to: plan.user_id,
    date: plan.date,
    task_description: plan.task_description,
    planned_hours: hoursToDecimal(plan.hours_planned),
    client: refs.client ?? undefined,
    org: refs.org ?? plan.organization ?? undefined,
  };
}

// ─── Attendance ──────────────────────────────────────────────────────────────

export function dtoToAttendance(dto: AttendanceDto): AttendanceRecord {
  const unpacked = unpackAttendanceFromServer({
    status: dto.status,
    work_location: dto.work_location,
  });
  return {
    id: dto.uid,
    user_id: dto.user_detail.uid,
    employee_name: dto.user_detail.full_name,
    date: dto.date,
    login_time: dto.login_time,
    logout_time: dto.logout_time,
    work_location: unpacked.work_location,
    status: unpacked.status,
    remarks: dto.remarks,
    updated_at: dto.updated_at,
  };
}

export function attendanceToCreate(
  record: AttendanceRecord,
): AttendanceCreate {
  const packed = packAttendanceForServer({
    status: record.status,
    work_location: record.work_location,
  });
  return {
    date: record.date,
    status: packed.status as AttendanceStatusValue,
    work_location: (packed.work_location ?? "Office") as WorkLocationValue,
    login_time: record.login_time ?? undefined,
    logout_time: record.logout_time ?? undefined,
    remarks: record.remarks ?? undefined,
  };
}

// ─── Lead ────────────────────────────────────────────────────────────────────

export function dtoToLead(dto: LeadDto): Lead {
  return {
    id: dto.uid,
    serialNo: dto.serial_no,
    // Prefer the free-text ``client_name`` (new primary storage). Fall back
    // to ``client_detail.name`` for legacy leads that were pinned to a master
    // before we switched to free text.
    client: dto.client_name || dto.client_detail?.name || "",
    contact_person: dto.contact_person || null,
    contact_email: dto.contact_email || null,
    contact_phone: dto.contact_phone || null,
    lead_source: dto.lead_source || null,
    reference_from: dto.reference_from || null,
    status: dto.status_detail?.name ?? "",
    priority: dto.priority,
    assigned_to: dto.assigned_to_detail?.full_name ?? null,
    estimated_value: dto.estimated_value
      ? Number.parseFloat(dto.estimated_value)
      : null,
    action_taken: dto.action_taken || null,
    next_step: dto.next_step || null,
    next_step_date: dto.next_step_date,
    remarks: dto.remarks || null,
    created_by: dto.created_by_detail?.uid ?? null,
    created_at: dto.created_at,
    updated_at: dto.updated_at,
  };
}

export interface LeadWriteRefs {
  readonly client?: string;
  readonly status: number;
  readonly assigned_to?: string;
}

export function leadToCreate(lead: Lead, refs: LeadWriteRefs): LeadCreate {
  return {
    client: refs.client ?? undefined,
    contact_person: lead.contact_person ?? undefined,
    contact_email: lead.contact_email ?? undefined,
    contact_phone: lead.contact_phone ?? undefined,
    lead_source: lead.lead_source ?? undefined,
    reference_from: lead.reference_from ?? undefined,
    status: refs.status,
    priority: (lead.priority as LeadCreate["priority"]) || "Medium",
    assigned_to: refs.assigned_to ?? undefined,
    estimated_value:
      lead.estimated_value !== null && lead.estimated_value !== undefined
        ? lead.estimated_value.toFixed(2)
        : "0.00",
    action_taken: lead.action_taken ?? undefined,
    next_step: lead.next_step ?? undefined,
    next_step_date: lead.next_step_date ?? undefined,
    remarks: lead.remarks ?? undefined,
  };
}
