"""
Backup / Restore API.

GET  /api/backup/         — dump entire org state as a single JSON document.
POST /api/backup/restore/ — load a previously exported backup back into the DB.
"""

from collections.abc import Callable
from typing import Any

from django.db import transaction
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import IsAdmin

CollectorFn = Callable[..., list[dict[str, Any]]]

SCHEMA_VERSION = 1
UPSERT_MAX_ERRORS = 50
REPLACE_MAX_ERRORS = 0


def _uid(val):
    """Return val as a str UUID, or None."""
    if val is None:
        return None
    return str(val)


# ---------------------------------------------------------------------------
# Resource collectors
# ---------------------------------------------------------------------------


def _collect_orgs(org=None):
    from users.models import Org

    qs = Org.objects.filter(pk=org.pk) if org else Org.objects.all()
    return [
        {
            "uid": _uid(o.uid),
            "name": o.name,
            "created_at": o.created_at.isoformat(),
            "updated_at": o.updated_at.isoformat(),
        }
        for o in qs
    ]


def _collect_profiles(org=None):
    from users.models import User

    qs = User.objects.select_related("org")
    if org:
        qs = qs.filter(org=org)
    return [
        {
            "uid": _uid(u.uid),
            "email": u.email,
            "username": u.username,
            "full_name": u.full_name,
            "role": u.role,
            "avatar_color": u.avatar_color,
            "org": _uid(u.org.uid) if u.org else None,
            "is_active": u.is_active,
        }
        for u in qs
    ]


def _collect_masters(org=None):
    from core.masters.models import Master

    qs = Master.objects.select_related("org")
    if org:
        qs = qs.filter(org=org)
    return [
        {
            "uid": _uid(m.uid),
            "name": m.name,
            "type": m.type,
            "color": m.color,
            "is_active": m.is_active,
            "sort_order": m.sort_order,
            "org": _uid(m.org.uid) if m.org else None,
            "created_at": m.created_at.isoformat(),
            "updated_at": m.updated_at.isoformat(),
        }
        for m in qs
    ]


def _collect_app_settings(org=None):
    from core.settings_app.models import AppSetting

    qs = AppSetting.objects.select_related("org")
    if org:
        qs = qs.filter(org=org)
    return [
        {
            "key": s.key,
            "value": s.value,
            "description": s.description,
            "org": _uid(s.org.uid) if s.org else None,
            "updated_at": s.updated_at.isoformat(),
        }
        for s in qs
    ]


def _collect_tasks(org=None):
    from core.tasks.models import Task

    return [
        {
            "uid": _uid(t.uid),
            "serial_no": t.serial_no,
            "title": t.title,
            "description": t.description,
            "status": t.status,
            "recurrence": t.recurrence,
            "target_date": t.target_date.isoformat() if t.target_date else None,
            "expected_date": t.expected_date.isoformat() if t.expected_date else None,
            "completed_date": t.completed_date.isoformat() if t.completed_date else None,
            "remarks": t.remarks,
            "org": _uid(t.org.uid) if t.org else None,
            "client": _uid(t.client.uid) if t.client else None,
            "category": _uid(t.category.uid) if t.category else None,
            "responsible": _uid(t.responsible.uid) if t.responsible else None,
            "created_by": _uid(t.created_by.uid) if t.created_by else None,
            "created_at": t.created_at.isoformat(),
            "updated_at": t.updated_at.isoformat(),
        }
        for t in (Task.objects.filter(org=org) if org else Task.objects)
        .select_related("org", "client", "category", "responsible", "created_by")
        .all()
    ]


def _collect_task_logs(org=None):
    from core.tasks.models import TaskLog

    qs = TaskLog.objects.select_related("task", "changed_by")
    if org:
        qs = qs.filter(task__org=org)
    return [
        {
            "task": _uid(tl.task.uid),
            "changed_by": _uid(tl.changed_by.uid) if tl.changed_by else None,
            "changed_by_name": tl.changed_by_name,
            "changed_at": tl.changed_at.isoformat(),
            "changes": tl.changes,
        }
        for tl in qs
    ]


def _collect_work_logs(org=None):
    from core.worklog.models import WorkLog

    qs = WorkLog.objects.select_related("user", "client", "org")
    if org:
        qs = qs.filter(org=org)
    return [
        {
            "uid": _uid(w.uid),
            "date": w.date.isoformat(),
            "task_description": w.task_description,
            "hours_worked": str(w.hours_worked),
            "priority": w.priority,
            "sort_order": w.sort_order,
            "user": _uid(w.user.uid),
            "client": _uid(w.client.uid) if w.client else None,
            "org": _uid(w.org.uid) if w.org else None,
            "created_at": w.created_at.isoformat(),
            "updated_at": w.updated_at.isoformat(),
        }
        for w in qs
    ]


def _collect_work_plans(org=None):
    from core.worklog.models import WorkPlan

    qs = WorkPlan.objects.select_related("assigned_to", "client", "org", "created_by")
    if org:
        qs = qs.filter(org=org)
    return [
        {
            "uid": _uid(w.uid),
            "date": w.date.isoformat() if w.date else None,
            "task_description": w.task_description,
            "planned_hours": str(w.planned_hours),
            "assigned_to": _uid(w.assigned_to.uid),
            "client": _uid(w.client.uid) if w.client else None,
            "org": _uid(w.org.uid) if w.org else None,
            "created_by": _uid(w.created_by.uid) if w.created_by else None,
            "created_at": w.created_at.isoformat(),
            "updated_at": w.updated_at.isoformat(),
        }
        for w in qs
    ]


def _collect_attendance(org=None):
    from core.attendance.models import Attendance

    qs = Attendance.objects.select_related("user", "org")
    if org:
        qs = qs.filter(org=org)
    return [
        {
            "uid": _uid(a.uid),
            "date": a.date.isoformat(),
            "status": a.status,
            "work_location": a.work_location,
            "login_time": a.login_time.isoformat() if a.login_time else None,
            "logout_time": a.logout_time.isoformat() if a.logout_time else None,
            "remarks": a.remarks,
            "user": _uid(a.user.uid),
            "org": _uid(a.org.uid) if a.org else None,
            "created_at": a.created_at.isoformat(),
            "updated_at": a.updated_at.isoformat(),
        }
        for a in qs
    ]


def _collect_holidays(org=None):
    from core.holidays.models import Holiday

    qs = Holiday.objects.select_related("org")
    if org:
        qs = qs.filter(org=org)
    return [
        {
            "uid": _uid(h.uid),
            "name": h.name,
            "date": h.date.isoformat(),
            "type": h.type,
            "org": _uid(h.org.uid) if h.org else None,
            "created_at": h.created_at.isoformat(),
            "updated_at": h.updated_at.isoformat(),
        }
        for h in qs
    ]


def _collect_notices(org=None):
    from core.notices.models import Notice

    qs = Notice.objects.select_related("org", "client", "created_by")
    if org:
        qs = qs.filter(org=org)
    return [
        {
            "uid": _uid(n.uid),
            "serial_no": n.serial_no,
            "dispute_nature": n.dispute_nature,
            "fy": n.fy,
            "received_date": n.received_date.isoformat() if n.received_date else None,
            "replied_date": n.replied_date.isoformat() if n.replied_date else None,
            "next_target_date": n.next_target_date.isoformat() if n.next_target_date else None,
            "remarks": n.remarks,
            "status": n.status,
            "org": _uid(n.org.uid) if n.org else None,
            "client": _uid(n.client.uid) if n.client else None,
            "created_by": _uid(n.created_by.uid) if n.created_by else None,
            "created_at": n.created_at.isoformat(),
            "updated_at": n.updated_at.isoformat(),
        }
        for n in qs
    ]


def _collect_lead_statuses(org=None):
    from core.leads.models import LeadStatus

    return [
        {"name": ls.name, "color": ls.color, "sort_order": ls.sort_order, "is_active": ls.is_active}
        for ls in LeadStatus.objects.all()
    ]


def _collect_leads(org=None):
    from core.leads.models import Lead

    return [
        {
            "uid": _uid(lead.uid),
            "serial_no": lead.serial_no,
            "contact_person": lead.contact_person,
            "contact_email": lead.contact_email,
            "contact_phone": lead.contact_phone,
            "lead_source": lead.lead_source,
            "reference_from": lead.reference_from,
            "priority": lead.priority,
            "estimated_value": str(lead.estimated_value),
            "action_taken": lead.action_taken,
            "next_step": lead.next_step,
            "next_step_date": lead.next_step_date.isoformat() if lead.next_step_date else None,
            "remarks": lead.remarks,
            "org": _uid(lead.org.uid) if lead.org else None,
            "client": _uid(lead.client.uid) if lead.client else None,
            "status": lead.status.name if lead.status else None,
            "assigned_to": _uid(lead.assigned_to.uid) if lead.assigned_to else None,
            "created_by": _uid(lead.created_by.uid) if lead.created_by else None,
            "created_at": lead.created_at.isoformat(),
            "updated_at": lead.updated_at.isoformat(),
        }
        for lead in (Lead.objects.filter(org=org) if org else Lead.objects)
        .select_related("org", "client", "status", "assigned_to", "created_by")
        .all()
    ]


def _collect_lead_history(org=None):
    from core.leads.models import LeadHistory

    qs = LeadHistory.objects.select_related("lead", "created_by")
    if org:
        qs = qs.filter(lead__org=org)
    return [
        {
            "uid": _uid(h.uid),
            "note": h.note,
            "lead": _uid(h.lead.uid),
            "created_by": _uid(h.created_by.uid) if h.created_by else None,
            "created_at": h.created_at.isoformat(),
            "updated_at": h.updated_at.isoformat(),
        }
        for h in qs
    ]


def _collect_invoice_plans(org=None):
    from core.invoices.models import InvoicePlan

    return [
        {
            "uid": _uid(p.uid),
            "serial_no": p.serial_no,
            "job_description": p.job_description,
            "periodicity": p.periodicity,
            "start_month": p.start_month.isoformat(),
            "end_month": p.end_month.isoformat(),
            "invoice_day": p.invoice_day,
            "base_amount": str(p.base_amount),
            "org": _uid(p.org.uid) if p.org else None,
            "client": _uid(p.client.uid) if p.client else None,
            "created_by": _uid(p.created_by.uid) if p.created_by else None,
            "created_at": p.created_at.isoformat(),
            "updated_at": p.updated_at.isoformat(),
        }
        for p in (InvoicePlan.objects.filter(org=org) if org else InvoicePlan.objects)
        .select_related("org", "client", "created_by")
        .all()
    ]


def _collect_invoice_entries(org=None):
    from core.invoices.models import InvoiceEntry

    qs = InvoiceEntry.objects.select_related("plan", "uploaded_by", "approved_by")
    if org:
        qs = qs.filter(plan__org=org)
    return [
        {
            "uid": _uid(e.uid),
            "invoice_month": e.invoice_month.isoformat(),
            "invoice_date": e.invoice_date.isoformat() if e.invoice_date else None,
            "amount": str(e.amount) if e.amount is not None else None,
            "status": e.status,
            "invoice_number": e.invoice_number,
            "notes": e.notes,
            "rejection_reason": e.rejection_reason,
            "plan": _uid(e.plan.uid),
            "uploaded_by": _uid(e.uploaded_by.uid) if e.uploaded_by else None,
            "uploaded_at": e.uploaded_at.isoformat() if e.uploaded_at else None,
            "approved_by": _uid(e.approved_by.uid) if e.approved_by else None,
            "approved_at": e.approved_at.isoformat() if e.approved_at else None,
            "created_at": e.created_at.isoformat(),
            "updated_at": e.updated_at.isoformat(),
        }
        for e in qs
    ]


def _collect_chat_rooms(org=None):
    from core.chat.models import ChatRoom

    qs = ChatRoom.objects.select_related("org", "created_by")
    if org:
        qs = qs.filter(org=org)
    return [
        {
            "uid": _uid(r.uid),
            "name": r.name,
            "type": r.type,
            "org": _uid(r.org.uid) if r.org else None,
            "created_by": _uid(r.created_by.uid) if r.created_by else None,
            "created_at": r.created_at.isoformat(),
            "updated_at": r.updated_at.isoformat(),
        }
        for r in qs
    ]


def _collect_chat_members(org=None):
    from core.chat.models import ChatMember

    qs = ChatMember.objects.select_related("room", "user")
    if org:
        qs = qs.filter(room__org=org)
    return [
        {
            "room": _uid(m.room.uid),
            "user": _uid(m.user.uid),
            "joined_at": m.joined_at.isoformat() if m.joined_at else None,
            "last_read_at": m.last_read_at.isoformat() if m.last_read_at else None,
        }
        for m in qs
    ]


def _collect_chat_messages(include_soft_deleted=False, org=None):
    from core.chat.models import ChatMessage

    qs = ChatMessage.objects.select_related("room", "sender")
    if not include_soft_deleted:
        qs = qs.filter(is_deleted=False)
    if org:
        qs = qs.filter(room__org=org)
    return [
        {
            "uid": _uid(msg.uid),
            "message": msg.message,
            "is_deleted": msg.is_deleted,
            "room": _uid(msg.room.uid),
            "sender": _uid(msg.sender.uid) if msg.sender else None,
            "created_at": msg.created_at.isoformat(),
            "updated_at": msg.updated_at.isoformat(),
        }
        for msg in qs.all()
    ]


def _collect_employees(org=None):
    from core.employees.models import Employee

    return [
        {
            "uid": _uid(e.uid),
            "employee_name": e.employee_name,
            "status": e.status,
            "date_of_joining": e.date_of_joining.isoformat() if e.date_of_joining else None,
            "date_of_birth": e.date_of_birth.isoformat() if e.date_of_birth else None,
            "gender": e.gender,
            "blood_group": e.blood_group,
            "marital_status": e.marital_status,
            "father_name": e.father_name,
            "phone": e.phone,
            "alt_phone": e.alt_phone,
            "email": e.email,
            "permanent_address": e.permanent_address,
            "current_address": e.current_address,
            "aadhar_number": e.aadhar_number,
            "pan_number": e.pan_number,
            "bank_name": e.bank_name,
            "bank_account": e.bank_account,
            "ifsc_code": e.ifsc_code,
            "emergency_contact_name": e.emergency_contact_name,
            "emergency_contact_phone": e.emergency_contact_phone,
            "emergency_contact_relation": e.emergency_contact_relation,
            "reference_name": e.reference_name,
            "reference_contact": e.reference_contact,
            "reference_relation": e.reference_relation,
            "org": _uid(e.org.uid) if e.org else None,
            "user": _uid(e.user.uid) if e.user else None,
            "created_by": _uid(e.created_by.uid) if e.created_by else None,
            "created_at": e.created_at.isoformat(),
            "updated_at": e.updated_at.isoformat(),
        }
        for e in (Employee.objects.filter(org=org) if org else Employee.objects)
        .select_related("org", "user", "created_by")
        .all()
    ]


def _collect_employee_salary(org=None):
    from core.employees.models import EmployeeSalary

    qs = EmployeeSalary.objects.select_related("employee")
    if org:
        qs = qs.filter(employee__org=org)
    return [
        {
            "employee": _uid(s.employee.uid),
            "designation": s.designation,
            "department": s.department,
            "fixed_salary": str(s.fixed_salary) if s.fixed_salary is not None else None,
            "basic_salary": str(s.basic_salary) if s.basic_salary is not None else None,
            "hra": str(s.hra) if s.hra is not None else None,
            "da": str(s.da) if s.da is not None else None,
            "other_allowances": str(s.other_allowances) if s.other_allowances is not None else None,
            "pf_number": s.pf_number,
            "esi_number": s.esi_number,
            "uan_number": s.uan_number,
            "effective_from": s.effective_from.isoformat(),
            "effective_to": s.effective_to.isoformat() if s.effective_to else None,
            "remarks": s.remarks,
            "created_at": s.created_at.isoformat(),
            "updated_at": s.updated_at.isoformat(),
        }
        for s in qs
    ]


def _collect_growth_plans(org=None):
    from core.growth.models import GrowthPlan

    return [
        {
            "uid": _uid(g.uid),
            "activity": g.activity,
            "target_month": g.target_month.isoformat() if g.target_month else None,
            "steps_taken": g.steps_taken,
            "steps_to_take": g.steps_to_take,
            "status": g.status,
            "priority": g.priority,
            "remarks": g.remarks,
            "org": _uid(g.org.uid) if g.org else None,
            "assigned_to": _uid(g.assigned_to.uid) if g.assigned_to else None,
            "created_by": _uid(g.created_by.uid) if g.created_by else None,
            "created_at": g.created_at.isoformat(),
            "updated_at": g.updated_at.isoformat(),
        }
        for g in (GrowthPlan.objects.filter(org=org) if org else GrowthPlan.objects)
        .select_related("org", "assigned_to", "created_by")
        .all()
    ]


def _collect_pace_goals(org=None):
    from core.pace.models import PaceGoal

    return [
        {
            "uid": _uid(g.uid),
            "goal_type": g.goal_type,
            "title": g.title,
            "description": g.description,
            "status": g.status,
            "priority": g.priority,
            "current_rating": g.current_rating,
            "target_rating": g.target_rating,
            "success_criteria": g.success_criteria,
            "frequency": g.frequency,
            "target": g.target,
            "tracking_method": g.tracking_method,
            "learning_action": g.learning_action,
            "completion_by": g.completion_by.isoformat() if g.completion_by else None,
            "iceberg_level": g.iceberg_level,
            "focus_area": g.focus_area,
            "daily_practice": g.daily_practice,
            "org": _uid(g.org.uid) if g.org else None,
            "profile": _uid(g.profile.uid) if g.profile else None,
            "created_by": _uid(g.created_by.uid) if g.created_by else None,
            "created_at": g.created_at.isoformat(),
            "updated_at": g.updated_at.isoformat(),
        }
        for g in (PaceGoal.objects.filter(org=org) if org else PaceGoal.objects)
        .select_related("org", "profile", "created_by")
        .all()
    ]


def _collect_pace_goal_reviews(org=None):
    from core.pace.models import PaceGoalReview

    qs = PaceGoalReview.objects.select_related("goal", "reviewed_by")
    if org:
        qs = qs.filter(goal__org=org)
    return [
        {
            "uid": _uid(r.uid),
            "review_date": r.review_date.isoformat(),
            "previous_rating": r.previous_rating,
            "new_rating": r.new_rating,
            "reviewer_name": r.reviewer_name,
            "comments": r.comments,
            "goal": _uid(r.goal.uid),
            "reviewed_by": _uid(r.reviewed_by.uid) if r.reviewed_by else None,
            "created_at": r.created_at.isoformat(),
        }
        for r in qs
    ]


def _collect_pace_meetings(org=None):
    from core.pace.models import PaceMeeting

    return [
        {
            "uid": _uid(m.uid),
            "title": m.title,
            "meeting_type": m.meeting_type,
            "scheduled_date": m.scheduled_date.isoformat(),
            "scheduled_time": m.scheduled_time.isoformat() if m.scheduled_time else None,
            "duration_minutes": m.duration_minutes,
            "status": m.status,
            "agenda": m.agenda,
            "minutes": m.minutes,
            "attendees": m.attendees,
            "action_items": m.action_items,
            "conducted_by": m.conducted_by,
            "org": _uid(m.org.uid) if m.org else None,
            "created_by": _uid(m.created_by.uid) if m.created_by else None,
            "created_at": m.created_at.isoformat(),
            "updated_at": m.updated_at.isoformat(),
        }
        for m in (PaceMeeting.objects.filter(org=org) if org else PaceMeeting.objects)
        .select_related("org", "created_by")
        .all()
    ]


def _collect_pace_checklist(org=None):
    from core.pace.models import PaceChecklist

    return [
        {
            "uid": _uid(c.uid),
            "fy": c.fy,
            "week_number": c.week_number,
            "item_number": c.item_number,
            "action_item": c.action_item,
            "done": c.done,
            "notes": c.notes,
            "org": _uid(c.org.uid) if c.org else None,
            "created_at": c.created_at.isoformat(),
            "updated_at": c.updated_at.isoformat(),
        }
        for c in (PaceChecklist.objects.filter(org=org) if org else PaceChecklist.objects).select_related("org").all()
    ]


def _collect_client_classifications(org=None):
    from core.pace.models import ClientClassification

    return [
        {
            "uid": _uid(cc.uid),
            "classification": cc.classification,
            "revenue_tier": cc.revenue_tier,
            "strategic_importance": cc.strategic_importance,
            "relationship_health": cc.relationship_health,
            "growth_potential": cc.growth_potential,
            "risk_level": cc.risk_level,
            "notes": cc.notes,
            "org": _uid(cc.org.uid) if cc.org else None,
            "client": _uid(cc.client.uid) if cc.client else None,
            "created_at": cc.created_at.isoformat(),
            "updated_at": cc.updated_at.isoformat(),
        }
        for cc in (ClientClassification.objects.filter(org=org) if org else ClientClassification.objects)
        .select_related("org", "client")
        .all()
    ]


RESOURCE_COLLECTORS: dict[str, CollectorFn] = {
    "orgs": _collect_orgs,
    "profiles": _collect_profiles,
    "masters": _collect_masters,
    "app_settings": _collect_app_settings,
    "tasks": _collect_tasks,
    "task_logs": _collect_task_logs,
    "work_logs": _collect_work_logs,
    "work_plans": _collect_work_plans,
    "attendance": _collect_attendance,
    "holidays": _collect_holidays,
    "notices": _collect_notices,
    "lead_statuses": _collect_lead_statuses,
    "leads": _collect_leads,
    "lead_history": _collect_lead_history,
    "invoice_plans": _collect_invoice_plans,
    "invoice_entries": _collect_invoice_entries,
    "chat_rooms": _collect_chat_rooms,
    "chat_members": _collect_chat_members,
    "chat_messages": _collect_chat_messages,
    "employees": _collect_employees,
    "employee_salary": _collect_employee_salary,
    "growth_plans": _collect_growth_plans,
    "pace_goals": _collect_pace_goals,
    "pace_goal_reviews": _collect_pace_goal_reviews,
    "pace_meetings": _collect_pace_meetings,
    "pace_checklist": _collect_pace_checklist,
    "client_classifications": _collect_client_classifications,
}


# ---------------------------------------------------------------------------
# Backup view
# ---------------------------------------------------------------------------


class BackupView(APIView):
    permission_classes = [IsAdmin]
    throttle_scope = "backup"

    # Hard cap on total rows in a single export. Above this, callers must
    # use ``?resources=`` to slice the export into smaller requests; the
    # whole payload is materialised in memory today, so unbounded exports
    # risk OOM / timeouts on large tenants.
    MAX_EXPORT_ROWS = 200_000

    def get(self, request):
        from core.audit.models import log as audit_log

        include_soft_deleted = request.query_params.get("include_soft_deleted", "").lower() == "true"
        resources_param = request.query_params.get("resources", "")
        requested = [r.strip() for r in resources_param.split(",") if r.strip()] if resources_param else None
        counts_only = request.query_params.get("counts_only", "").lower() == "true"

        user = request.user
        user_org = getattr(user, "org", None)
        with transaction.atomic():
            resources = {}
            for key, collector in RESOURCE_COLLECTORS.items():
                if requested and key not in requested:
                    continue
                if key == "chat_messages":
                    resources[key] = _collect_chat_messages(include_soft_deleted=include_soft_deleted, org=user_org)
                else:
                    resources[key] = collector(org=user_org)

        counts = {k: len(v) for k, v in resources.items()}
        total_rows = sum(counts.values())

        if counts_only:
            return Response(
                {
                    "schema_version": SCHEMA_VERSION,
                    "generated_at": timezone.now().isoformat(),
                    "counts": counts,
                    "total_rows": total_rows,
                    "max_export_rows": self.MAX_EXPORT_ROWS,
                }
            )

        if total_rows > self.MAX_EXPORT_ROWS:
            return Response(
                {
                    "error": "export-too-large",
                    "total_rows": total_rows,
                    "max_export_rows": self.MAX_EXPORT_ROWS,
                    "counts": counts,
                    "hint": "Retry with ?resources=<csv> to slice the export, or ?counts_only=true to preflight.",
                },
                status=413,
            )

        audit_log(
            user,
            "backup.export",
            resource_type="backup",
            changes={"counts": counts, "include_soft_deleted": include_soft_deleted},
            request=request,
        )
        return Response(
            {
                "schema_version": SCHEMA_VERSION,
                "generated_at": timezone.now().isoformat(),
                "generated_by": {"uid": str(user.uid), "username": user.username},
                "counts": counts,
                "resources": resources,
            }
        )


# ---------------------------------------------------------------------------
# Restore view
# ---------------------------------------------------------------------------

RESTORE_ORDER = [
    "orgs",
    "profiles",
    "masters",
    "app_settings",
    "holidays",
    "tasks",
    "task_logs",
    "work_logs",
    "work_plans",
    "attendance",
    "notices",
    "lead_statuses",
    "leads",
    "lead_history",
    "invoice_plans",
    "invoice_entries",
    "chat_rooms",
    "chat_members",
    "chat_messages",
    "employees",
    "employee_salary",
    "growth_plans",
    "pace_goals",
    "pace_goal_reviews",
    "pace_meetings",
    "pace_checklist",
    "client_classifications",
]


def _restore_resource(resource_name, rows, mode, errors, per_resource):
    handler = _RESTORE_HANDLERS.get(resource_name)
    if handler is None:
        return 0, 0, 0
    return handler(rows, mode, errors, per_resource, resource_name)


class RestoreView(APIView):
    permission_classes = [IsAdmin]
    throttle_scope = "restore"

    def post(self, request):
        from core.audit.models import log as audit_log

        if not request.data.get("confirm"):
            return Response({"error": "missing-confirm"}, status=400)

        user_org = getattr(request.user, "org", None)
        if user_org:
            user_org_uid = str(user_org.uid)
            for rows in request.data.get("resources", {}).values():
                if not isinstance(rows, list):
                    continue
                for row in rows:
                    if isinstance(row, dict) and row.get("org") and row["org"] != user_org_uid:
                        return Response(
                            {
                                "error": "cross-org-restore-rejected",
                                "message": "Restore data contains references to organizations outside your access.",
                            },
                            status=403,
                        )

        schema_version = request.data.get("schema_version")
        if schema_version != SCHEMA_VERSION:
            return Response(
                {"error": "schema-version-mismatch", "expected": SCHEMA_VERSION, "got": schema_version},
                status=400,
            )

        mode = request.data.get("mode", "upsert")
        if mode not in ("upsert", "replace"):
            return Response({"error": "mode must be 'upsert' or 'replace'"}, status=400)

        resources = request.data.get("resources", {})
        max_errors = REPLACE_MAX_ERRORS if mode == "replace" else UPSERT_MAX_ERRORS

        errors: list = []
        per_resource: dict = {}
        total_inserted = total_updated = total_failed = 0

        with transaction.atomic():
            for resource_name in RESTORE_ORDER:
                rows = resources.get(resource_name, [])
                if not rows:
                    continue
                ins, upd, fail = _restore_resource(resource_name, rows, mode, errors, per_resource)
                total_inserted += ins
                total_updated += upd
                total_failed += fail

                if total_failed > max_errors:
                    transaction.set_rollback(True)
                    return Response(
                        {
                            "error": "too-many-errors",
                            "message": f"Error threshold {max_errors} exceeded — transaction rolled back.",
                            "errors": errors,
                        },
                        status=422,
                    )

        audit_log(
            request.user,
            "backup.restore",
            resource_type="backup",
            changes={
                "mode": mode,
                "inserted": total_inserted,
                "updated": total_updated,
                "failed": total_failed,
                "resources_processed": len(per_resource),
            },
            request=request,
        )
        return Response(
            {
                "mode": mode,
                "summary": {
                    "resources_processed": len(per_resource),
                    "total_rows": total_inserted + total_updated + total_failed,
                    "inserted": total_inserted,
                    "updated": total_updated,
                    "failed": total_failed,
                },
                "per_resource": per_resource,
                "errors": errors,
            },
            status=207,
        )


# ---------------------------------------------------------------------------
# Restore handlers
# ---------------------------------------------------------------------------


def _h_orgs(rows, mode, errors, per_resource, resource_name):
    from users.models import Org

    ins = upd = fail = 0
    for i, row in enumerate(rows):
        try:
            with transaction.atomic():
                _, created = Org.objects.update_or_create(uid=row["uid"], defaults={"name": row["name"]})
                if created:
                    ins += 1
                else:
                    upd += 1
        except Exception as exc:
            fail += 1
            errors.append({"resource": resource_name, "index": i, "error": str(exc), "row": row})
    per_resource[resource_name] = {"inserted": ins, "updated": upd, "failed": fail}
    return ins, upd, fail


def _h_profiles(rows, mode, errors, per_resource, resource_name):
    from users.models import Org, User

    ins = upd = fail = 0
    for i, row in enumerate(rows):
        try:
            with transaction.atomic():
                org = Org.objects.filter(uid=row["org"]).first() if row.get("org") else None
                _, created = User.objects.update_or_create(
                    uid=row["uid"],
                    defaults={
                        "email": row.get("email", ""),
                        "username": row.get("username", ""),
                        "full_name": row.get("full_name", ""),
                        "role": row.get("role", "employee"),
                        "avatar_color": row.get("avatar_color", ""),
                        "org": org,
                        "is_active": row.get("is_active", True),
                    },
                )
                if created:
                    ins += 1
                else:
                    upd += 1
        except Exception as exc:
            fail += 1
            errors.append({"resource": resource_name, "index": i, "error": str(exc), "row": row})
    per_resource[resource_name] = {"inserted": ins, "updated": upd, "failed": fail}
    return ins, upd, fail


def _h_masters(rows, mode, errors, per_resource, resource_name):
    from core.masters.models import Master
    from users.models import Org

    ins = upd = fail = 0
    for i, row in enumerate(rows):
        try:
            with transaction.atomic():
                org = Org.objects.filter(uid=row["org"]).first() if row.get("org") else None
                _, created = Master.objects.update_or_create(
                    uid=row["uid"],
                    defaults={
                        "name": row.get("name", ""),
                        "type": row.get("type", "client"),
                        "color": row.get("color", ""),
                        "is_active": row.get("is_active", True),
                        "sort_order": row.get("sort_order", 0),
                        "org": org,
                    },
                )
                if created:
                    ins += 1
                else:
                    upd += 1
        except Exception as exc:
            fail += 1
            errors.append({"resource": resource_name, "index": i, "error": str(exc), "row": row})
    per_resource[resource_name] = {"inserted": ins, "updated": upd, "failed": fail}
    return ins, upd, fail


def _h_app_settings(rows, mode, errors, per_resource, resource_name):
    from core.settings_app.models import AppSetting
    from users.models import Org

    ins = upd = fail = 0
    for i, row in enumerate(rows):
        try:
            with transaction.atomic():
                org = Org.objects.filter(uid=row["org"]).first() if row.get("org") else None
                _, created = AppSetting.objects.update_or_create(
                    org=org,
                    key=row["key"],
                    defaults={"value": row.get("value", ""), "description": row.get("description", "")},
                )
                if created:
                    ins += 1
                else:
                    upd += 1
        except Exception as exc:
            fail += 1
            errors.append({"resource": resource_name, "index": i, "error": str(exc), "row": row})
    per_resource[resource_name] = {"inserted": ins, "updated": upd, "failed": fail}
    return ins, upd, fail


def _h_tasks(rows, mode, errors, per_resource, resource_name):
    from django.contrib.auth import get_user_model

    from core.masters.models import Master
    from core.tasks.models import Task
    from users.models import Org

    User = get_user_model()
    ins = upd = fail = 0
    for i, row in enumerate(rows):
        try:
            with transaction.atomic():
                defaults = {
                    "title": row.get("title", ""),
                    "description": row.get("description", ""),
                    "status": row.get("status", "pending"),
                    "recurrence": row.get("recurrence", "onetime"),
                    "target_date": row.get("target_date"),
                    "expected_date": row.get("expected_date"),
                    "completed_date": row.get("completed_date"),
                    "remarks": row.get("remarks", ""),
                    "org": Org.objects.filter(uid=row["org"]).first() if row.get("org") else None,
                    "client": Master.objects.filter(uid=row["client"]).first() if row.get("client") else None,
                    "category": Master.objects.filter(uid=row["category"]).first() if row.get("category") else None,
                    "responsible": User.objects.filter(uid=row["responsible"]).first()
                    if row.get("responsible")
                    else None,
                    "created_by": User.objects.filter(uid=row["created_by"]).first() if row.get("created_by") else None,
                }
                _, created = Task.objects.update_or_create(uid=row["uid"], defaults=defaults)
                if created:
                    ins += 1
                else:
                    upd += 1
        except Exception as exc:
            fail += 1
            errors.append({"resource": resource_name, "index": i, "error": str(exc), "row": row})
    per_resource[resource_name] = {"inserted": ins, "updated": upd, "failed": fail}
    return ins, upd, fail


def _h_task_logs(rows, mode, errors, per_resource, resource_name):
    from django.contrib.auth import get_user_model

    from core.tasks.models import Task, TaskLog

    User = get_user_model()
    ins = upd = fail = 0
    for i, row in enumerate(rows):
        try:
            with transaction.atomic():
                task = Task.objects.filter(uid=row["task"]).first()
                if not task:
                    raise ValueError(f"Task uid={row['task']} not found")
                changed_by = User.objects.filter(uid=row["changed_by"]).first() if row.get("changed_by") else None
                _, created = TaskLog.objects.get_or_create(
                    task=task,
                    changed_at=row["changed_at"],
                    defaults={
                        "changed_by": changed_by,
                        "changed_by_name": row.get("changed_by_name", ""),
                        "changes": row.get("changes", {}),
                    },
                )
                if created:
                    ins += 1
                else:
                    upd += 1
        except Exception as exc:
            fail += 1
            errors.append({"resource": resource_name, "index": i, "error": str(exc), "row": row})
    per_resource[resource_name] = {"inserted": ins, "updated": upd, "failed": fail}
    return ins, upd, fail


def _h_work_logs(rows, mode, errors, per_resource, resource_name):
    from django.contrib.auth import get_user_model

    from core.masters.models import Master
    from core.worklog.models import WorkLog
    from users.models import Org

    User = get_user_model()
    ins = upd = fail = 0
    for i, row in enumerate(rows):
        try:
            with transaction.atomic():
                user = User.objects.filter(uid=row["user"]).first()
                if not user:
                    raise ValueError(f"User uid={row['user']} not found")
                defaults = {
                    "date": row["date"],
                    "task_description": row.get("task_description", ""),
                    "hours_worked": row.get("hours_worked", 0),
                    "priority": row.get("priority", "Medium"),
                    "sort_order": row.get("sort_order", 0),
                    "user": user,
                    "client": Master.objects.filter(uid=row["client"]).first() if row.get("client") else None,
                    "org": Org.objects.filter(uid=row["org"]).first() if row.get("org") else None,
                }
                _, created = WorkLog.objects.update_or_create(uid=row["uid"], defaults=defaults)
                if created:
                    ins += 1
                else:
                    upd += 1
        except Exception as exc:
            fail += 1
            errors.append({"resource": resource_name, "index": i, "error": str(exc), "row": row})
    per_resource[resource_name] = {"inserted": ins, "updated": upd, "failed": fail}
    return ins, upd, fail


def _h_work_plans(rows, mode, errors, per_resource, resource_name):
    from django.contrib.auth import get_user_model

    from core.masters.models import Master
    from core.worklog.models import WorkPlan
    from users.models import Org

    User = get_user_model()
    ins = upd = fail = 0
    for i, row in enumerate(rows):
        try:
            with transaction.atomic():
                assigned_to = User.objects.filter(uid=row["assigned_to"]).first()
                if not assigned_to:
                    raise ValueError(f"User uid={row['assigned_to']} not found")
                defaults = {
                    "date": row.get("date"),
                    "task_description": row.get("task_description", ""),
                    "planned_hours": row.get("planned_hours", 0),
                    "assigned_to": assigned_to,
                    "client": Master.objects.filter(uid=row["client"]).first() if row.get("client") else None,
                    "org": Org.objects.filter(uid=row["org"]).first() if row.get("org") else None,
                    "created_by": User.objects.filter(uid=row["created_by"]).first() if row.get("created_by") else None,
                }
                _, created = WorkPlan.objects.update_or_create(uid=row["uid"], defaults=defaults)
                if created:
                    ins += 1
                else:
                    upd += 1
        except Exception as exc:
            fail += 1
            errors.append({"resource": resource_name, "index": i, "error": str(exc), "row": row})
    per_resource[resource_name] = {"inserted": ins, "updated": upd, "failed": fail}
    return ins, upd, fail


def _h_attendance(rows, mode, errors, per_resource, resource_name):
    from django.contrib.auth import get_user_model

    from core.attendance.models import Attendance
    from users.models import Org

    User = get_user_model()
    ins = upd = fail = 0
    for i, row in enumerate(rows):
        try:
            with transaction.atomic():
                user = User.objects.filter(uid=row["user"]).first()
                if not user:
                    raise ValueError(f"User uid={row['user']} not found")
                defaults = {
                    "date": row["date"],
                    "status": row.get("status", "Present"),
                    "work_location": row.get("work_location", ""),
                    "login_time": row.get("login_time"),
                    "logout_time": row.get("logout_time"),
                    "remarks": row.get("remarks", ""),
                    "user": user,
                    "org": Org.objects.filter(uid=row["org"]).first() if row.get("org") else None,
                }
                _, created = Attendance.objects.update_or_create(uid=row["uid"], defaults=defaults)
                if created:
                    ins += 1
                else:
                    upd += 1
        except Exception as exc:
            fail += 1
            errors.append({"resource": resource_name, "index": i, "error": str(exc), "row": row})
    per_resource[resource_name] = {"inserted": ins, "updated": upd, "failed": fail}
    return ins, upd, fail


def _h_holidays(rows, mode, errors, per_resource, resource_name):
    from core.holidays.models import Holiday
    from users.models import Org

    ins = upd = fail = 0
    for i, row in enumerate(rows):
        try:
            with transaction.atomic():
                defaults = {
                    "name": row.get("name", ""),
                    "date": row["date"],
                    "type": row.get("type", "National"),
                    "org": Org.objects.filter(uid=row["org"]).first() if row.get("org") else None,
                }
                _, created = Holiday.objects.update_or_create(uid=row["uid"], defaults=defaults)
                if created:
                    ins += 1
                else:
                    upd += 1
        except Exception as exc:
            fail += 1
            errors.append({"resource": resource_name, "index": i, "error": str(exc), "row": row})
    per_resource[resource_name] = {"inserted": ins, "updated": upd, "failed": fail}
    return ins, upd, fail


def _h_notices(rows, mode, errors, per_resource, resource_name):
    from django.contrib.auth import get_user_model

    from core.masters.models import Master
    from core.notices.models import Notice
    from users.models import Org

    User = get_user_model()
    ins = upd = fail = 0
    for i, row in enumerate(rows):
        try:
            with transaction.atomic():
                defaults = {
                    "serial_no": row.get("serial_no", ""),
                    "dispute_nature": row.get("dispute_nature", ""),
                    "fy": row.get("fy", ""),
                    "received_date": row.get("received_date"),
                    "replied_date": row.get("replied_date"),
                    "next_target_date": row.get("next_target_date"),
                    "remarks": row.get("remarks", ""),
                    "status": row.get("status", "Open"),
                    "org": Org.objects.filter(uid=row["org"]).first() if row.get("org") else None,
                    "client": Master.objects.filter(uid=row["client"]).first() if row.get("client") else None,
                    "created_by": User.objects.filter(uid=row["created_by"]).first() if row.get("created_by") else None,
                }
                _, created = Notice.objects.update_or_create(uid=row["uid"], defaults=defaults)
                if created:
                    ins += 1
                else:
                    upd += 1
        except Exception as exc:
            fail += 1
            errors.append({"resource": resource_name, "index": i, "error": str(exc), "row": row})
    per_resource[resource_name] = {"inserted": ins, "updated": upd, "failed": fail}
    return ins, upd, fail


def _h_lead_statuses(rows, mode, errors, per_resource, resource_name):
    from core.leads.models import LeadStatus

    ins = upd = fail = 0
    for i, row in enumerate(rows):
        try:
            with transaction.atomic():
                _, created = LeadStatus.objects.update_or_create(
                    name=row["name"],
                    defaults={
                        "color": row.get("color", ""),
                        "sort_order": row.get("sort_order", 0),
                        "is_active": row.get("is_active", True),
                    },
                )
                if created:
                    ins += 1
                else:
                    upd += 1
        except Exception as exc:
            fail += 1
            errors.append({"resource": resource_name, "index": i, "error": str(exc), "row": row})
    per_resource[resource_name] = {"inserted": ins, "updated": upd, "failed": fail}
    return ins, upd, fail


def _h_leads(rows, mode, errors, per_resource, resource_name):
    from django.contrib.auth import get_user_model

    from core.leads.models import Lead, LeadStatus
    from core.masters.models import Master
    from users.models import Org

    User = get_user_model()
    ins = upd = fail = 0
    for i, row in enumerate(rows):
        try:
            with transaction.atomic():
                defaults = {
                    "serial_no": row.get("serial_no", ""),
                    "contact_person": row.get("contact_person", ""),
                    "contact_email": row.get("contact_email", ""),
                    "contact_phone": row.get("contact_phone", ""),
                    "lead_source": row.get("lead_source", ""),
                    "reference_from": row.get("reference_from", ""),
                    "priority": row.get("priority", "Medium"),
                    "estimated_value": row.get("estimated_value", 0),
                    "action_taken": row.get("action_taken", ""),
                    "next_step": row.get("next_step", ""),
                    "next_step_date": row.get("next_step_date"),
                    "remarks": row.get("remarks", ""),
                    "org": Org.objects.filter(uid=row["org"]).first() if row.get("org") else None,
                    "client": Master.objects.filter(uid=row["client"]).first() if row.get("client") else None,
                    "status": LeadStatus.objects.filter(name=row["status"]).first() if row.get("status") else None,
                    "assigned_to": User.objects.filter(uid=row["assigned_to"]).first()
                    if row.get("assigned_to")
                    else None,
                    "created_by": User.objects.filter(uid=row["created_by"]).first() if row.get("created_by") else None,
                }
                _, created = Lead.objects.update_or_create(uid=row["uid"], defaults=defaults)
                if created:
                    ins += 1
                else:
                    upd += 1
        except Exception as exc:
            fail += 1
            errors.append({"resource": resource_name, "index": i, "error": str(exc), "row": row})
    per_resource[resource_name] = {"inserted": ins, "updated": upd, "failed": fail}
    return ins, upd, fail


def _h_lead_history(rows, mode, errors, per_resource, resource_name):
    from django.contrib.auth import get_user_model

    from core.leads.models import Lead, LeadHistory

    User = get_user_model()
    ins = upd = fail = 0
    for i, row in enumerate(rows):
        try:
            with transaction.atomic():
                lead = Lead.objects.filter(uid=row["lead"]).first()
                if not lead:
                    raise ValueError(f"Lead uid={row['lead']} not found")
                defaults = {
                    "note": row.get("note", ""),
                    "lead": lead,
                    "created_by": User.objects.filter(uid=row["created_by"]).first() if row.get("created_by") else None,
                }
                _, created = LeadHistory.objects.update_or_create(uid=row["uid"], defaults=defaults)
                if created:
                    ins += 1
                else:
                    upd += 1
        except Exception as exc:
            fail += 1
            errors.append({"resource": resource_name, "index": i, "error": str(exc), "row": row})
    per_resource[resource_name] = {"inserted": ins, "updated": upd, "failed": fail}
    return ins, upd, fail


def _h_invoice_plans(rows, mode, errors, per_resource, resource_name):
    from django.contrib.auth import get_user_model

    from core.invoices.models import InvoicePlan
    from core.masters.models import Master
    from users.models import Org

    User = get_user_model()
    ins = upd = fail = 0
    for i, row in enumerate(rows):
        try:
            with transaction.atomic():
                defaults = {
                    "serial_no": row.get("serial_no", ""),
                    "job_description": row.get("job_description", ""),
                    "periodicity": row.get("periodicity", "Monthly"),
                    "start_month": row["start_month"],
                    "end_month": row["end_month"],
                    "invoice_day": row.get("invoice_day", 1),
                    "base_amount": row.get("base_amount", 0),
                    "org": Org.objects.filter(uid=row["org"]).first() if row.get("org") else None,
                    "client": Master.objects.filter(uid=row["client"]).first() if row.get("client") else None,
                    "created_by": User.objects.filter(uid=row["created_by"]).first() if row.get("created_by") else None,
                }
                _, created = InvoicePlan.objects.update_or_create(uid=row["uid"], defaults=defaults)
                if created:
                    ins += 1
                else:
                    upd += 1
        except Exception as exc:
            fail += 1
            errors.append({"resource": resource_name, "index": i, "error": str(exc), "row": row})
    per_resource[resource_name] = {"inserted": ins, "updated": upd, "failed": fail}
    return ins, upd, fail


def _h_invoice_entries(rows, mode, errors, per_resource, resource_name):
    from django.contrib.auth import get_user_model

    from core.invoices.models import InvoiceEntry, InvoicePlan

    User = get_user_model()
    ins = upd = fail = 0
    for i, row in enumerate(rows):
        try:
            with transaction.atomic():
                plan = InvoicePlan.objects.filter(uid=row["plan"]).first()
                if not plan:
                    raise ValueError(f"InvoicePlan uid={row['plan']} not found")
                defaults = {
                    "invoice_month": row["invoice_month"],
                    "invoice_date": row.get("invoice_date"),
                    "amount": row.get("amount"),
                    "status": row.get("status", "Pending"),
                    "invoice_number": row.get("invoice_number", ""),
                    "notes": row.get("notes", ""),
                    "rejection_reason": row.get("rejection_reason", ""),
                    "plan": plan,
                    "uploaded_by": User.objects.filter(uid=row["uploaded_by"]).first()
                    if row.get("uploaded_by")
                    else None,
                    "uploaded_at": row.get("uploaded_at"),
                    "approved_by": User.objects.filter(uid=row["approved_by"]).first()
                    if row.get("approved_by")
                    else None,
                    "approved_at": row.get("approved_at"),
                }
                _, created = InvoiceEntry.objects.update_or_create(uid=row["uid"], defaults=defaults)
                if created:
                    ins += 1
                else:
                    upd += 1
        except Exception as exc:
            fail += 1
            errors.append({"resource": resource_name, "index": i, "error": str(exc), "row": row})
    per_resource[resource_name] = {"inserted": ins, "updated": upd, "failed": fail}
    return ins, upd, fail


def _h_chat_rooms(rows, mode, errors, per_resource, resource_name):
    from django.contrib.auth import get_user_model

    from core.chat.models import ChatRoom
    from users.models import Org

    User = get_user_model()
    ins = upd = fail = 0
    for i, row in enumerate(rows):
        try:
            with transaction.atomic():
                defaults = {
                    "name": row.get("name", ""),
                    "type": row.get("type", "direct"),
                    "org": Org.objects.filter(uid=row["org"]).first() if row.get("org") else None,
                    "created_by": User.objects.filter(uid=row["created_by"]).first() if row.get("created_by") else None,
                }
                _, created = ChatRoom.objects.update_or_create(uid=row["uid"], defaults=defaults)
                if created:
                    ins += 1
                else:
                    upd += 1
        except Exception as exc:
            fail += 1
            errors.append({"resource": resource_name, "index": i, "error": str(exc), "row": row})
    per_resource[resource_name] = {"inserted": ins, "updated": upd, "failed": fail}
    return ins, upd, fail


def _h_chat_members(rows, mode, errors, per_resource, resource_name):
    from django.contrib.auth import get_user_model

    from core.chat.models import ChatMember, ChatRoom

    User = get_user_model()
    ins = upd = fail = 0
    for i, row in enumerate(rows):
        try:
            with transaction.atomic():
                room = ChatRoom.objects.filter(uid=row["room"]).first()
                user = User.objects.filter(uid=row["user"]).first()
                if not room or not user:
                    raise ValueError("room or user not found")
                _, created = ChatMember.objects.get_or_create(
                    room=room,
                    user=user,
                    defaults={"joined_at": row.get("joined_at"), "last_read_at": row.get("last_read_at")},
                )
                if created:
                    ins += 1
                else:
                    upd += 1
        except Exception as exc:
            fail += 1
            errors.append({"resource": resource_name, "index": i, "error": str(exc), "row": row})
    per_resource[resource_name] = {"inserted": ins, "updated": upd, "failed": fail}
    return ins, upd, fail


def _h_chat_messages(rows, mode, errors, per_resource, resource_name):
    from django.contrib.auth import get_user_model

    from core.chat.models import ChatMessage, ChatRoom

    User = get_user_model()
    ins = upd = fail = 0
    for i, row in enumerate(rows):
        try:
            with transaction.atomic():
                room = ChatRoom.objects.filter(uid=row["room"]).first()
                if not room:
                    raise ValueError(f"ChatRoom uid={row['room']} not found")
                defaults = {
                    "message": row.get("message", ""),
                    "is_deleted": row.get("is_deleted", False),
                    "room": room,
                    "sender": User.objects.filter(uid=row["sender"]).first() if row.get("sender") else None,
                }
                _, created = ChatMessage.objects.update_or_create(uid=row["uid"], defaults=defaults)
                if created:
                    ins += 1
                else:
                    upd += 1
        except Exception as exc:
            fail += 1
            errors.append({"resource": resource_name, "index": i, "error": str(exc), "row": row})
    per_resource[resource_name] = {"inserted": ins, "updated": upd, "failed": fail}
    return ins, upd, fail


def _h_employees(rows, mode, errors, per_resource, resource_name):
    from django.contrib.auth import get_user_model

    from core.employees.models import Employee
    from users.models import Org

    User = get_user_model()
    ins = upd = fail = 0
    for i, row in enumerate(rows):
        try:
            with transaction.atomic():
                defaults = {
                    k: row.get(k, "")
                    for k in [
                        "employee_name",
                        "status",
                        "gender",
                        "blood_group",
                        "marital_status",
                        "father_name",
                        "phone",
                        "alt_phone",
                        "email",
                        "permanent_address",
                        "current_address",
                        "aadhar_number",
                        "pan_number",
                        "bank_name",
                        "bank_account",
                        "ifsc_code",
                        "emergency_contact_name",
                        "emergency_contact_phone",
                        "emergency_contact_relation",
                        "reference_name",
                        "reference_contact",
                        "reference_relation",
                    ]
                }
                defaults["date_of_joining"] = row.get("date_of_joining")
                defaults["date_of_birth"] = row.get("date_of_birth")
                defaults["org"] = Org.objects.filter(uid=row["org"]).first() if row.get("org") else None
                defaults["user"] = User.objects.filter(uid=row["user"]).first() if row.get("user") else None
                defaults["created_by"] = (
                    User.objects.filter(uid=row["created_by"]).first() if row.get("created_by") else None
                )
                _, created = Employee.objects.update_or_create(uid=row["uid"], defaults=defaults)
                if created:
                    ins += 1
                else:
                    upd += 1
        except Exception as exc:
            fail += 1
            errors.append({"resource": resource_name, "index": i, "error": str(exc), "row": row})
    per_resource[resource_name] = {"inserted": ins, "updated": upd, "failed": fail}
    return ins, upd, fail


def _h_employee_salary(rows, mode, errors, per_resource, resource_name):
    from django.contrib.auth import get_user_model

    from core.employees.models import Employee, EmployeeSalary

    User = get_user_model()
    ins = upd = fail = 0
    for i, row in enumerate(rows):
        try:
            with transaction.atomic():
                employee = Employee.objects.filter(uid=row["employee"]).first()
                if not employee:
                    raise ValueError(f"Employee uid={row['employee']} not found")
                defaults = {
                    "designation": row.get("designation", ""),
                    "department": row.get("department", ""),
                    "fixed_salary": row.get("fixed_salary"),
                    "basic_salary": row.get("basic_salary"),
                    "hra": row.get("hra"),
                    "da": row.get("da"),
                    "other_allowances": row.get("other_allowances"),
                    "pf_number": row.get("pf_number", ""),
                    "esi_number": row.get("esi_number", ""),
                    "uan_number": row.get("uan_number", ""),
                    "effective_from": row["effective_from"],
                    "effective_to": row.get("effective_to"),
                    "remarks": row.get("remarks", ""),
                    "employee": employee,
                    "created_by": User.objects.filter(uid=row["created_by"]).first() if row.get("created_by") else None,
                }
                uid = row.get("uid")
                if uid:
                    _, created = EmployeeSalary.objects.update_or_create(uid=uid, defaults=defaults)
                else:
                    _, created = EmployeeSalary.objects.get_or_create(
                        employee=employee, effective_from=row["effective_from"], defaults=defaults
                    )
                if created:
                    ins += 1
                else:
                    upd += 1
        except Exception as exc:
            fail += 1
            errors.append({"resource": resource_name, "index": i, "error": str(exc), "row": row})
    per_resource[resource_name] = {"inserted": ins, "updated": upd, "failed": fail}
    return ins, upd, fail


def _h_growth_plans(rows, mode, errors, per_resource, resource_name):
    from django.contrib.auth import get_user_model

    from core.growth.models import GrowthPlan
    from users.models import Org

    User = get_user_model()
    ins = upd = fail = 0
    for i, row in enumerate(rows):
        try:
            with transaction.atomic():
                defaults = {
                    "activity": row.get("activity", ""),
                    "target_month": row.get("target_month"),
                    "steps_taken": row.get("steps_taken", ""),
                    "steps_to_take": row.get("steps_to_take", ""),
                    "status": row.get("status", "Not Started"),
                    "priority": row.get("priority", "Medium"),
                    "remarks": row.get("remarks", ""),
                    "org": Org.objects.filter(uid=row["org"]).first() if row.get("org") else None,
                    "assigned_to": User.objects.filter(uid=row["assigned_to"]).first()
                    if row.get("assigned_to")
                    else None,
                    "created_by": User.objects.filter(uid=row["created_by"]).first() if row.get("created_by") else None,
                }
                _, created = GrowthPlan.objects.update_or_create(uid=row["uid"], defaults=defaults)
                if created:
                    ins += 1
                else:
                    upd += 1
        except Exception as exc:
            fail += 1
            errors.append({"resource": resource_name, "index": i, "error": str(exc), "row": row})
    per_resource[resource_name] = {"inserted": ins, "updated": upd, "failed": fail}
    return ins, upd, fail


def _h_pace_goals(rows, mode, errors, per_resource, resource_name):
    from django.contrib.auth import get_user_model

    from core.pace.models import PaceGoal
    from users.models import Org

    User = get_user_model()
    ins = upd = fail = 0
    for i, row in enumerate(rows):
        try:
            with transaction.atomic():
                defaults = {
                    "goal_type": row.get("goal_type", "Skill"),
                    "title": row.get("title", ""),
                    "description": row.get("description", ""),
                    "status": row.get("status", "Not Started"),
                    "priority": row.get("priority", "Development"),
                    "current_rating": row.get("current_rating", 0),
                    "target_rating": row.get("target_rating", 0),
                    "success_criteria": row.get("success_criteria", ""),
                    "frequency": row.get("frequency", ""),
                    "target": row.get("target", ""),
                    "tracking_method": row.get("tracking_method", ""),
                    "learning_action": row.get("learning_action", ""),
                    "completion_by": row.get("completion_by"),
                    "iceberg_level": row.get("iceberg_level", ""),
                    "focus_area": row.get("focus_area", ""),
                    "daily_practice": row.get("daily_practice", ""),
                    "org": Org.objects.filter(uid=row["org"]).first() if row.get("org") else None,
                    "profile": User.objects.filter(uid=row["profile"]).first() if row.get("profile") else None,
                    "created_by": User.objects.filter(uid=row["created_by"]).first() if row.get("created_by") else None,
                }
                _, created = PaceGoal.objects.update_or_create(uid=row["uid"], defaults=defaults)
                if created:
                    ins += 1
                else:
                    upd += 1
        except Exception as exc:
            fail += 1
            errors.append({"resource": resource_name, "index": i, "error": str(exc), "row": row})
    per_resource[resource_name] = {"inserted": ins, "updated": upd, "failed": fail}
    return ins, upd, fail


def _h_pace_goal_reviews(rows, mode, errors, per_resource, resource_name):
    from django.contrib.auth import get_user_model

    from core.pace.models import PaceGoal, PaceGoalReview

    User = get_user_model()
    ins = upd = fail = 0
    for i, row in enumerate(rows):
        try:
            with transaction.atomic():
                goal = PaceGoal.objects.filter(uid=row["goal"]).first()
                if not goal:
                    raise ValueError(f"PaceGoal uid={row['goal']} not found")
                defaults = {
                    "review_date": row["review_date"],
                    "previous_rating": row.get("previous_rating", 0),
                    "new_rating": row.get("new_rating", 0),
                    "reviewer_name": row.get("reviewer_name", ""),
                    "comments": row.get("comments", ""),
                    "goal": goal,
                    "reviewed_by": User.objects.filter(uid=row["reviewed_by"]).first()
                    if row.get("reviewed_by")
                    else None,
                }
                _, created = PaceGoalReview.objects.update_or_create(uid=row["uid"], defaults=defaults)
                if created:
                    ins += 1
                else:
                    upd += 1
        except Exception as exc:
            fail += 1
            errors.append({"resource": resource_name, "index": i, "error": str(exc), "row": row})
    per_resource[resource_name] = {"inserted": ins, "updated": upd, "failed": fail}
    return ins, upd, fail


def _h_pace_meetings(rows, mode, errors, per_resource, resource_name):
    from django.contrib.auth import get_user_model

    from core.pace.models import PaceMeeting
    from users.models import Org

    User = get_user_model()
    ins = upd = fail = 0
    for i, row in enumerate(rows):
        try:
            with transaction.atomic():
                defaults = {
                    "title": row.get("title", ""),
                    "meeting_type": row.get("meeting_type", "Tactical"),
                    "scheduled_date": row["scheduled_date"],
                    "scheduled_time": row.get("scheduled_time"),
                    "duration_minutes": row.get("duration_minutes"),
                    "status": row.get("status", "Scheduled"),
                    "agenda": row.get("agenda", ""),
                    "minutes": row.get("minutes", ""),
                    "attendees": row.get("attendees", []),
                    "action_items": row.get("action_items", []),
                    "conducted_by": row.get("conducted_by", ""),
                    "org": Org.objects.filter(uid=row["org"]).first() if row.get("org") else None,
                    "created_by": User.objects.filter(uid=row["created_by"]).first() if row.get("created_by") else None,
                }
                _, created = PaceMeeting.objects.update_or_create(uid=row["uid"], defaults=defaults)
                if created:
                    ins += 1
                else:
                    upd += 1
        except Exception as exc:
            fail += 1
            errors.append({"resource": resource_name, "index": i, "error": str(exc), "row": row})
    per_resource[resource_name] = {"inserted": ins, "updated": upd, "failed": fail}
    return ins, upd, fail


def _h_pace_checklist(rows, mode, errors, per_resource, resource_name):
    from django.contrib.auth import get_user_model

    from core.pace.models import PaceChecklist
    from users.models import Org

    User = get_user_model()
    ins = upd = fail = 0
    for i, row in enumerate(rows):
        try:
            with transaction.atomic():
                org = Org.objects.filter(uid=row["org"]).first() if row.get("org") else None
                defaults = {
                    "action_item": row.get("action_item", ""),
                    "done": row.get("done", False),
                    "notes": row.get("notes", ""),
                    "updated_by": User.objects.filter(uid=row.get("updated_by")).first()
                    if row.get("updated_by")
                    else None,
                }
                uid = row.get("uid")
                if uid:
                    _, created = PaceChecklist.objects.update_or_create(
                        uid=uid,
                        defaults={
                            **defaults,
                            "org": org,
                            "fy": row["fy"],
                            "week_number": row["week_number"],
                            "item_number": row["item_number"],
                        },
                    )
                else:
                    _, created = PaceChecklist.objects.update_or_create(
                        org=org,
                        fy=row["fy"],
                        week_number=row["week_number"],
                        item_number=row["item_number"],
                        defaults=defaults,
                    )
                if created:
                    ins += 1
                else:
                    upd += 1
        except Exception as exc:
            fail += 1
            errors.append({"resource": resource_name, "index": i, "error": str(exc), "row": row})
    per_resource[resource_name] = {"inserted": ins, "updated": upd, "failed": fail}
    return ins, upd, fail


def _h_client_classifications(rows, mode, errors, per_resource, resource_name):
    from django.contrib.auth import get_user_model

    from core.masters.models import Master
    from core.pace.models import ClientClassification
    from users.models import Org

    User = get_user_model()
    ins = upd = fail = 0
    for i, row in enumerate(rows):
        try:
            with transaction.atomic():
                defaults = {
                    "classification": row.get("classification", ""),
                    "revenue_tier": row.get("revenue_tier", ""),
                    "strategic_importance": row.get("strategic_importance", ""),
                    "relationship_health": row.get("relationship_health", ""),
                    "growth_potential": row.get("growth_potential", ""),
                    "risk_level": row.get("risk_level", ""),
                    "notes": row.get("notes", ""),
                    "org": Org.objects.filter(uid=row["org"]).first() if row.get("org") else None,
                    "client": Master.objects.filter(uid=row["client"]).first() if row.get("client") else None,
                    "updated_by": User.objects.filter(uid=row.get("updated_by")).first()
                    if row.get("updated_by")
                    else None,
                }
                _, created = ClientClassification.objects.update_or_create(uid=row["uid"], defaults=defaults)
                if created:
                    ins += 1
                else:
                    upd += 1
        except Exception as exc:
            fail += 1
            errors.append({"resource": resource_name, "index": i, "error": str(exc), "row": row})
    per_resource[resource_name] = {"inserted": ins, "updated": upd, "failed": fail}
    return ins, upd, fail


_RESTORE_HANDLERS = {
    "orgs": _h_orgs,
    "profiles": _h_profiles,
    "masters": _h_masters,
    "app_settings": _h_app_settings,
    "tasks": _h_tasks,
    "task_logs": _h_task_logs,
    "work_logs": _h_work_logs,
    "work_plans": _h_work_plans,
    "attendance": _h_attendance,
    "holidays": _h_holidays,
    "notices": _h_notices,
    "lead_statuses": _h_lead_statuses,
    "leads": _h_leads,
    "lead_history": _h_lead_history,
    "invoice_plans": _h_invoice_plans,
    "invoice_entries": _h_invoice_entries,
    "chat_rooms": _h_chat_rooms,
    "chat_members": _h_chat_members,
    "chat_messages": _h_chat_messages,
    "employees": _h_employees,
    "employee_salary": _h_employee_salary,
    "growth_plans": _h_growth_plans,
    "pace_goals": _h_pace_goals,
    "pace_goal_reviews": _h_pace_goal_reviews,
    "pace_meetings": _h_pace_meetings,
    "pace_checklist": _h_pace_checklist,
    "client_classifications": _h_client_classifications,
}
