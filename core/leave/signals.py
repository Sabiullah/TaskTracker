"""Materialise + demolish Attendance rows for an approved/withdrawn leave.

Called only from ``LeaveRequest.apply_state_transition`` — never wired as
a generic post_save listener, because the safe place to mutate Attendance
rows is right after the LeaveRequest's own save inside one transaction.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.utils import timezone

from core.attendance.models import Attendance

if TYPE_CHECKING:
    from .models import LeaveRequest


def _wfh_row_kwargs(req: LeaveRequest, by_user, session: str) -> dict:
    """Field overrides for materialising a WFH request into Attendance.

    WFH days land as ``status='Present'`` + ``work_location='WFH'`` with
    ``approval_state='Approved'`` because the manager already signed off
    on the LeaveRequest itself. ``leave_session`` carries the half-day
    indicator (mirrors the Leave path) so a Half-Day Leave + Half-Day WFH
    on the same date can co-exist. Login/logout are cleared — the row is
    materialised before the day arrives; the employee will punch in later
    and ``quick_punch`` will update the times in place.
    """
    return {
        "status": "Present",
        "work_location": "WFH",
        "approval_state": "Approved",
        "approver": by_user,
        "approved_at": timezone.now(),
        "rejection_reason": "",
        "login_time": None,
        "logout_time": None,
        "leave_session": None if session == "Full" else session,
    }


def _leave_row_kwargs(req: LeaveRequest, session: str) -> dict:
    return {
        "status": "Leave",
        "work_location": "Office",
        "login_time": None,
        "logout_time": None,
        "leave_session": None if session == "Full" else session,
    }


def materialise_attendance(req: LeaveRequest, by_user) -> None:
    """Create one Attendance row per included date.

    If the date already has a non-Leave Half-Day row matching the unrequested
    half (e.g., user worked 1st half, leave is for 2nd half), keep that row
    and append a small remarks note instead of overwriting.

    For ``request_type='WFH'`` the row is materialised as a Present/WFH/
    Approved entry rather than Leave; everything else (skip holidays/Sundays,
    half-day handling, conflict guard) is identical.
    """
    is_wfh = req.request_type == "WFH"
    for date, session in req.included_dates():
        existing = Attendance.objects.filter(user=req.user, date=date).first()
        if existing and existing.status not in ("Leave", "Half Day"):
            # Conflict guard — this should have been caught by the approve view.
            # Be defensive and skip rather than overwrite.
            continue
        if existing and existing.status == "Half Day" and session != "Full":
            tag = "wfh" if is_wfh else "leave"
            note = f"[{tag}: {session.lower()}]"
            if note not in (existing.remarks or ""):
                existing.remarks = (existing.remarks + "\n" + note).strip() if existing.remarks else note
                existing.save(update_fields=["remarks", "updated_at"])
            continue
        # Either no row, or an existing Leave row — overwrite to canonical state.
        overrides = _wfh_row_kwargs(req, by_user, session) if is_wfh else _leave_row_kwargs(req, session)
        if existing is None:
            tag = "WFH" if is_wfh else "Leave"
            Attendance.objects.create(
                user=req.user,
                date=date,
                remarks=f"{tag}: {req.reason[:240]}" if req.reason else "",
                created_by=by_user,
                org=req.org,
                **overrides,
            )
        else:
            for k, v in overrides.items():
                setattr(existing, k, v)
            existing.save(update_fields=[*overrides.keys(), "updated_at"])


def demolish_attendance(req: LeaveRequest) -> None:
    """Remove Attendance rows that this leave previously materialised.

    Half-Day rows that we only annotated (didn't create) are kept; we strip
    the leave-note / wfh-note suffix.
    """
    is_wfh = req.request_type == "WFH"
    rows = Attendance.objects.filter(user=req.user, date__range=(req.from_date, req.to_date))
    for row in rows:
        # Wholly-owned rows from materialise — delete them. For a Leave
        # request that's the ``status='Leave'`` rows; for a WFH request
        # it's the ``status='Present' + work_location='WFH' + approver
        # set by the leave path``. We use ``approved_at`` recency as a
        # proxy isn't reliable, but ``work_location='WFH'`` + the
        # approval_state pattern is unambiguous: a punch-based WFH starts
        # Pending, never Approved without going through the WFH approve
        # endpoint, so an Approved WFH on a date covered by this request
        # came from us.
        if not is_wfh and row.status == "Leave":
            row.delete()
            continue
        if is_wfh and row.work_location == "WFH" and row.status == "Present" and row.approval_state == "Approved":
            row.delete()
            continue
        if row.status == "Half Day" and row.remarks:
            tag_prefix = "[wfh:" if is_wfh else "[leave:"
            cleaned_lines = [ln for ln in row.remarks.splitlines() if not ln.startswith(tag_prefix)]
            new_remarks = "\n".join(cleaned_lines).strip()
            if new_remarks != (row.remarks or ""):
                row.remarks = new_remarks
                row.save(update_fields=["remarks", "updated_at"])
