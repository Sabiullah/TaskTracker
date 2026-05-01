import { describe, expect, it } from "vitest";
import {
  attendanceToCreate,
  dtoToAttendance,
  dtoToAuthUser,
  dtoToLead,
  dtoToProfile,
  dtoToTask,
  dtoToWorkLog,
  dtoToWorkPlan,
  leadToCreate,
  taskToCreate,
  workLogToCreate,
  workPlanToCreate,
} from "@/lib/api/mappers";
import type {
  AttendanceDto,
  LeadDto,
  ProfileDto,
  TaskDto,
  WorkLogDto,
  WorkPlanDto,
} from "@/types/api";
import type { AttendanceRecord, Lead, Task, WorkLog, WorkPlan } from "@/types";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const BASE = {
  id: 1,
  uid: "uid-1",
  created_at: "2026-04-10T10:00:00Z",
  updated_at: "2026-04-10T10:00:00Z",
} as const;

const USER_REF = {
  id: 2,
  uid: "user-uid-2",
  full_name: "Alice",
  username: "alice",
} as const;

const MASTER_CLIENT = {
  id: 4,
  uid: "client-uid-4",
  name: "Focus",
  type: "client",
  color: "#000",
} as const;

const MASTER_CATEGORY = {
  id: 5,
  uid: "cat-uid-5",
  name: "Audit",
  type: "category",
  color: "#fff",
} as const;

// ─── Profile ─────────────────────────────────────────────────────────────────

// Minimal per-org membership fixture — every feature off, no audit entries.
const BLANK_MEMBERSHIP = {
  is_default: true,
  invoice_access: false,
  invoice_access_granted_by: null,
  invoice_access_granted_at: null,
  notice_access: false,
  notice_access_granted_by: null,
  notice_access_granted_at: null,
  masters_access: false,
  masters_access_granted_by: null,
  masters_access_granted_at: null,
  attendance_access: false,
  attendance_access_granted_by: null,
  attendance_access_granted_at: null,
  employee_access: false,
  employee_access_granted_by: null,
  employee_access_granted_at: null,
  leads_access: false,
  leads_access_granted_by: null,
  leads_access_granted_at: null,
  conveyance_access: false,
  conveyance_access_granted_by: null,
  conveyance_access_granted_at: null,
} as const;

describe("dtoToProfile", () => {
  it("maps flat fields and collapses empty manager_ids to null", () => {
    const dto: ProfileDto = {
      ...BASE,
      username: "alice",
      email: "alice@example.com",
      full_name: "Alice",
      avatar_color: "#abc",
      is_active: true,
      manager_id: null,
      manager_ids: [],
      orgs: [
        {
          ...BLANK_MEMBERSHIP,
          id: 3,
          uid: "org-uid-3",
          name: "4D",
          role: "admin",
          invoice_access: true,
          masters_access: true,
          attendance_access: true,
        },
      ],
      highest_role: "admin",
    };

    expect(dtoToProfile(dto)).toEqual({
      id: "uid-1",
      username: "alice",
      email: "alice@example.com",
      full_name: "Alice",
      manager_ids: null,
      avatar_color: "#abc",
      orgs: dto.orgs,
      highest_role: "admin",
    });
  });

  it("preserves non-empty manager_ids", () => {
    const dto: ProfileDto = {
      ...BASE,
      username: "bob",
      email: "bob@example.com",
      full_name: "Bob",
      avatar_color: "",
      is_active: true,
      manager_id: "m-1",
      manager_ids: ["m-1", "m-2"],
      orgs: [],
      highest_role: "employee",
    };

    expect(dtoToProfile(dto).manager_ids).toEqual(["m-1", "m-2"]);
  });
});

describe("dtoToAuthUser", () => {
  it("extracts only id / email / username", () => {
    const dto: ProfileDto = {
      ...BASE,
      username: "alice",
      email: "alice@example.com",
      full_name: "Alice",
      avatar_color: "#abc",
      is_active: true,
      manager_id: null,
      manager_ids: [],
      orgs: [],
      highest_role: "admin",
    };

    expect(dtoToAuthUser(dto)).toEqual({
      id: "uid-1",
      email: "alice@example.com",
      username: "alice",
    });
  });
});

// ─── Task ────────────────────────────────────────────────────────────────────

describe("dtoToTask", () => {
  it("maps field names and extracts _detail expansions", () => {
    const dto: TaskDto = {
      ...BASE,
      serial_no: 7,
      title: "",
      description: "GST filing",
      status: "today_task",
      recurrence: "monthly",
      target_date: "2026-04-15",
      expected_date: "2026-04-16",
      completed_date: null,
      remarks: "",
      client: "client-uid-4",
      client_detail: MASTER_CLIENT,
      category: "cat-uid-5",
      category_detail: MASTER_CATEGORY,
      org: "org-uid-3",
      org_uid: "org-uid-3",
      responsible: "user-uid-2",
      responsible_detail: USER_REF,
      reporting_manager: "user-uid-2",
      reporting_manager_detail: USER_REF,
      created_by_detail: USER_REF,
    };

    expect(dtoToTask(dto)).toEqual({
      id: "uid-1",
      serialNo: 7,
      client: "Focus",
      category: "Audit",
      description: "GST filing",
      status: "TodayTask",
      targetDate: "2026-04-15",
      expectedDate: "2026-04-16",
      completedDate: "",
      responsible: "Alice",
      reportingManager: "Alice",
      remarks: "",
      recurrence: "Monthly",
      organization: "org-uid-3",
      createdBy: "user-uid-2",
      createdAt: "2026-04-10T10:00:00Z",
    });
  });

  it("falls back to empty strings when _detail expansions are null", () => {
    const dto: TaskDto = {
      ...BASE,
      serial_no: 1,
      title: "",
      description: "Unassigned",
      status: "pending",
      recurrence: "onetime",
      target_date: null,
      expected_date: null,
      completed_date: null,
      remarks: "",
      client: null,
      client_detail: null,
      category: null,
      category_detail: null,
      org: "org-uid-3",
      org_uid: "org-uid-3",
      responsible: null,
      responsible_detail: null,
      reporting_manager: null,
      reporting_manager_detail: null,
      created_by_detail: null,
    };

    const task = dtoToTask(dto);
    expect(task.client).toBe("");
    expect(task.category).toBe("");
    expect(task.responsible).toBe("");
    expect(task.reportingManager).toBe("");
    expect(task.targetDate).toBe("");
    expect(task.createdBy).toBeNull();
  });
});

describe("taskToCreate", () => {
  it("maps domain status + recurrence back to Django values", () => {
    const task: Task = {
      id: "uid-1",
      serialNo: 1,
      client: "Focus",
      category: "Audit",
      description: "GST filing",
      status: "Completed Delay",
      targetDate: "2026-04-15",
      expectedDate: "2026-04-16",
      completedDate: "2026-04-20",
      responsible: "Alice",
      reportingManager: "Alice",
      remarks: "",
      recurrence: "Quarterly",
      organization: "org-uid-3",
      createdBy: null,
      createdAt: null,
    };

    const payload = taskToCreate(task, {
      client: "client-uid-4",
      category: "cat-uid-5",
      responsible: "user-uid-2",
      reporting_manager: "user-uid-2",
      org: "org-uid-3",
    });

    expect(payload).toEqual({
      description: "GST filing",
      status: "completed_delay",
      recurrence: "quarterly",
      target_date: "2026-04-15",
      expected_date: "2026-04-16",
      completed_date: "2026-04-20",
      remarks: "",
      client: "client-uid-4",
      category: "cat-uid-5",
      responsible: "user-uid-2",
      reporting_manager: "user-uid-2",
      org: "org-uid-3",
    });
  });

  it("sends blank date fields as explicit null so PATCH clears them", () => {
    // Empty strings must round-trip as `null`, not be dropped from the body.
    // On a PATCH the server treats omitted fields as "leave unchanged" — that
    // lets the previous cycle's completed_date stick to a recurring task
    // when its projected (cleared-for-display) instance is edited and saved.
    const task: Task = {
      id: "uid-1",
      serialNo: null,
      client: "",
      category: "",
      description: "No dates yet",
      status: "TBC",
      targetDate: "",
      expectedDate: "",
      completedDate: "",
      responsible: "",
      reportingManager: "",
      remarks: "",
      recurrence: "Onetime",
      organization: "",
      createdBy: null,
      createdAt: null,
    };

    const payload = taskToCreate(task);
    expect(payload.target_date).toBeNull();
    expect(payload.expected_date).toBeNull();
    expect(payload.completed_date).toBeNull();
  });

  it("clears prior completed_date when a recurring task's new-cycle instance is saved", () => {
    // Simulates the Board flow: useBoardTasks projects a recurring task into
    // a different cycle and clears completedDate/expectedDate/remarks for
    // display. When the user edits remarks/expectedDate and saves, the
    // payload MUST send completed_date as null so the server clears the
    // stale value from the previous cycle — otherwise the task gets
    // auto-marked completed on the next WS update (computeStatus sees a
    // populated completedDate and returns "Ontime").
    const projectedRecurring: Task = {
      id: "uid-7",
      serialNo: 12,
      client: "JMS",
      category: "Goal",
      description: "Cash Flow Budgeting",
      status: "Overdue",
      targetDate: "2026-05-04",   // projected May cycle
      expectedDate: "2026-05-10", // user-entered during edit
      completedDate: "",           // cleared by projection (was 2026-04-15)
      responsible: "Kasturi",
      reportingManager: "Kasturi",
      remarks: "May progress notes",
      recurrence: "Monthly",
      organization: "org-uid-3",
      createdBy: null,
      createdAt: null,
    };

    const payload = taskToCreate(projectedRecurring);
    expect(payload.completed_date).toBeNull();
    expect(payload.expected_date).toBe("2026-05-10");
    expect(payload.target_date).toBe("2026-05-04");
  });
});

// ─── WorkLog ─────────────────────────────────────────────────────────────────

describe("dtoToWorkLog / workLogToCreate", () => {
  it("converts decimal hours to H:MM on read", () => {
    const dto: WorkLogDto = {
      ...BASE,
      user_detail: USER_REF,
      date: "2026-04-10",
      task_description: "Audit prep",
      hours_worked: "3.50",
      priority: "Normal",
      sort_order: 0,
      client: "client-uid-4",
      client_detail: MASTER_CLIENT,
      org: "org-uid-3",
      org_uid: "org-uid-3",
    };

    expect(dtoToWorkLog(dto).hours_worked).toBe("3:30");
  });

  it("converts H:MM hours back to decimal on write", () => {
    const log: WorkLog = {
      id: "uid-1",
      name: "Alice",
      date: "2026-04-10",
      day: "Fri",
      client: "Focus",
      task_description: "Audit prep",
      hours_worked: "7:45",
      priority: "Priority",
      organization: "org-uid-3",
      sort_order: 0,
    };

    const payload = workLogToCreate(log, {
      client: "client-uid-4",
      org: "org-uid-3",
    });
    expect(payload.hours_worked).toBe("7.75");
    expect(payload.priority).toBe("Priority");
    expect(payload.client).toBe("client-uid-4");
  });
});

// ─── WorkPlan ────────────────────────────────────────────────────────────────

describe("dtoToWorkPlan / workPlanToCreate", () => {
  it("round-trips planned_hours through the H:MM ↔ decimal boundary", () => {
    const dto: WorkPlanDto = {
      ...BASE,
      assigned_to_detail: USER_REF,
      created_by_detail: USER_REF,
      date: "2026-04-10",
      task_description: "Plan audit",
      planned_hours: "2.25",
      client: "client-uid-4",
      client_detail: MASTER_CLIENT,
      org: "org-uid-3",
      org_uid: "org-uid-3",
    };

    const domain = dtoToWorkPlan(dto);
    expect(domain.hours_planned).toBe("2:15");

    const plan: WorkPlan = {
      ...domain,
      hours_planned: "4:30",
    };
    const payload = workPlanToCreate(plan, { org: "org-uid-3" });
    expect(payload.planned_hours).toBe("4.50");
  });
});

// ─── Attendance ──────────────────────────────────────────────────────────────

describe("dtoToAttendance / attendanceToCreate", () => {
  it("maps Present + work_location=WFH through unchanged on read (status and location are orthogonal)", () => {
    const dto: AttendanceDto = {
      ...BASE,
      user_detail: USER_REF,
      date: "2026-04-10",
      status: "Present",
      work_location: "WFH",
      login_time: "09:00:00",
      logout_time: "17:30:00",
      total_hours: 8.5,
      remarks: "",
      approval_state: null,
      approver: null,
      approver_detail: null,
      approved_at: null,
      rejection_reason: "",
      leave_session: null,
    };

    const record = dtoToAttendance(dto);
    expect(record.status).toBe("Present");
    expect(record.work_location).toBe("WFH");
    expect(record.employee_name).toBe("Alice");
    expect(record.total_hours).toBe(8.5);
  });

  it("passes ordinary status + location through unchanged on write", () => {
    const record: AttendanceRecord = {
      id: "uid-1",
      user_id: "user-uid-2",
      employee_name: "Alice",
      date: "2026-04-10",
      login_time: "09:00",
      logout_time: null,
      work_location: "WFH",
      status: "Present",
      remarks: "",
    };

    const payload = attendanceToCreate(record);
    expect(payload.status).toBe("Present");
    expect(payload.work_location).toBe("WFH");
  });

  it("passes through ordinary status values untouched", () => {
    const record: AttendanceRecord = {
      id: "uid-1",
      user_id: "user-uid-2",
      employee_name: "Alice",
      date: "2026-04-10",
      login_time: null,
      logout_time: null,
      work_location: "Office",
      status: "Leave",
      remarks: "",
    };

    const payload = attendanceToCreate(record);
    expect(payload.status).toBe("Leave");
    expect(payload.work_location).toBe("Office");
  });

  it("surfaces approval fields on a Pending WFH attendance row", () => {
    const dto: AttendanceDto = {
      id: 7,
      uid: "att-uid-7",
      created_at: "2026-04-25T09:00:00Z",
      updated_at: "2026-04-25T09:00:00Z",
      user_detail: { id: 1, uid: "user-uid-1", full_name: "Alice", username: "alice" },
      date: "2026-04-25",
      status: "Present",
      work_location: "WFH",
      login_time: "09:00:00",
      logout_time: "18:00:00",
      total_hours: 9,
      remarks: "",
      approval_state: "Pending",
      approver: null,
      approver_detail: null,
      approved_at: null,
      rejection_reason: "",
      leave_session: null,
    };
    const record = dtoToAttendance(dto);
    expect(record.approval_state).toBe("Pending");
    expect(record.approver_name).toBeNull();
    expect(record.approved_at).toBeNull();
    expect(record.rejection_reason).toBe("");
    expect(record.leave_session).toBeNull();
  });

  it("surfaces approver_name on an Approved WFH attendance row", () => {
    const dto: AttendanceDto = {
      id: 8,
      uid: "att-uid-8",
      created_at: "2026-04-25T09:00:00Z",
      updated_at: "2026-04-26T15:00:00Z",
      user_detail: { id: 1, uid: "user-uid-1", full_name: "Alice", username: "alice" },
      date: "2026-04-25",
      status: "Present",
      work_location: "WFH",
      login_time: "09:00:00",
      logout_time: "18:00:00",
      total_hours: 9,
      remarks: "",
      approval_state: "Approved",
      approver: 99,
      approver_detail: { id: 99, uid: "approver-uid", full_name: "Bob", username: "bob" },
      approved_at: "2026-04-26T15:00:00Z",
      rejection_reason: "",
      leave_session: null,
    };
    const record = dtoToAttendance(dto);
    expect(record.approval_state).toBe("Approved");
    expect(record.approver_name).toBe("Bob");
    expect(record.approved_at).toBe("2026-04-26T15:00:00Z");
  });
});

// ─── Lead ────────────────────────────────────────────────────────────────────

describe("dtoToLead / leadToCreate", () => {
  it("maps decimal estimated_value to a number on read", () => {
    const dto: LeadDto = {
      ...BASE,
      serial_no: 5,
      client: "client-uid-4",
      client_detail: MASTER_CLIENT,
      client_name: "",
      contact_person: "Ravi",
      contact_email: "ravi@example.com",
      contact_phone: "",
      lead_source: "Referral",
      reference_from: "",
      status: 2,
      status_detail: {
        id: 2,
        name: "Warm",
        color: "#d97706",
        sort_order: 2,
        is_active: true,
      },
      priority: "High",
      assigned_to: "user-uid-2",
      assigned_to_detail: USER_REF,
      estimated_value: "15000.00",
      action_taken: "",
      next_step: "",
      next_step_date: null,
      remarks: "",
      history: [],
      created_by_detail: USER_REF,
    };

    const lead = dtoToLead(dto);
    expect(lead.serialNo).toBe(5);
    expect(lead.client).toBe("Focus");
    expect(lead.status).toBe("Warm");
    expect(lead.estimated_value).toBe(15000);
    expect(lead.assigned_to).toBe("Alice");
  });

  it("writes back estimated_value as a two-decimal string", () => {
    const lead: Lead = {
      id: "uid-1",
      serialNo: 5,
      client: "Focus",
      contact_person: "Ravi",
      contact_email: null,
      contact_phone: null,
      lead_source: "Referral",
      reference_from: null,
      status: "Warm",
      priority: "High",
      assigned_to: "Alice",
      estimated_value: 15000,
      action_taken: null,
      next_step: null,
      next_step_date: null,
      remarks: null,
      created_by: null,
      created_at: null,
      updated_at: null,
    };

    const payload = leadToCreate(lead, {
      client: "client-uid-4",
      status: 2,
      assigned_to: "user-uid-2",
    });
    expect(payload.estimated_value).toBe("15000.00");
    expect(payload.status).toBe(2);
    expect(payload.priority).toBe("High");
  });

  it("emits '0.00' when estimated_value is null", () => {
    const lead: Lead = {
      id: "uid-1",
      serialNo: null,
      client: "",
      contact_person: null,
      contact_email: null,
      contact_phone: null,
      lead_source: null,
      reference_from: null,
      status: "",
      priority: "Medium",
      assigned_to: null,
      estimated_value: null,
      action_taken: null,
      next_step: null,
      next_step_date: null,
      remarks: null,
      created_by: null,
      created_at: null,
      updated_at: null,
    };

    expect(leadToCreate(lead, { status: 1 }).estimated_value).toBe("0.00");
  });
});
