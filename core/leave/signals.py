"""Materialise + demolish Attendance rows for an approved/withdrawn leave.

Called only from ``LeaveRequest.apply_state_transition`` — never wired as
a generic post_save listener, because the safe place to mutate Attendance
rows is right after the LeaveRequest's own save inside one transaction.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from core.attendance.models import Attendance

if TYPE_CHECKING:
    from .models import LeaveRequest


def materialise_attendance(req: LeaveRequest, by_user) -> None:
    """Create one Attendance row per included date.

    If the date already has a non-Leave Half-Day row matching the unrequested
    half (e.g., user worked 1st half, leave is for 2nd half), keep that row
    and append a small remarks note instead of overwriting.
    """
    for date, session in req.included_dates():
        existing = Attendance.objects.filter(user=req.user, date=date).first()
        if existing and existing.status not in ("Leave", "Half Day"):
            # Conflict guard — this should have been caught by the approve view.
            # Be defensive and skip rather than overwrite.
            continue
        if existing and existing.status == "Half Day" and session != "Full":
            note = f"[leave: {session.lower()}]"
            if note not in (existing.remarks or ""):
                existing.remarks = (existing.remarks + "\n" + note).strip() if existing.remarks else note
                existing.save(update_fields=["remarks", "updated_at"])
            continue
        # Either no row, or an existing Leave row — overwrite to canonical state.
        if existing is None:
            Attendance.objects.create(
                user=req.user,
                date=date,
                status="Leave",
                work_location="Office",
                login_time=None,
                logout_time=None,
                remarks=f"Leave: {req.reason[:240]}" if req.reason else "",
                created_by=by_user,
                org=req.org,
                leave_session=None if session == "Full" else session,
            )
        else:
            existing.status = "Leave"
            existing.work_location = "Office"
            existing.login_time = None
            existing.logout_time = None
            existing.leave_session = None if session == "Full" else session
            existing.save(
                update_fields=["status", "work_location", "login_time", "logout_time", "leave_session", "updated_at"]
            )


def demolish_attendance(req: LeaveRequest) -> None:
    """Remove Attendance rows that this leave previously materialised.

    Half-Day rows that we only annotated (didn't create) are kept; we strip
    the leave-note suffix.
    """
    rows = Attendance.objects.filter(user=req.user, date__range=(req.from_date, req.to_date))
    for row in rows:
        if row.status == "Leave":
            row.delete()
            continue
        if row.status == "Half Day" and row.remarks:
            cleaned_lines = [ln for ln in row.remarks.splitlines() if not ln.startswith("[leave:")]
            new_remarks = "\n".join(cleaned_lines).strip()
            if new_remarks != (row.remarks or ""):
                row.remarks = new_remarks
                row.save(update_fields=["remarks", "updated_at"])
