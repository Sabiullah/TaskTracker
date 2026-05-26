"""Pure-Python cell derivation for the monthly Attendance Matrix.

Inputs are plain dicts so this module is testable without the DB. The view
adapter assembles inputs from querysets and hands them to ``build_matrix``.
"""

from __future__ import annotations

import calendar
import datetime as dt
from dataclasses import dataclass


@dataclass
class CellInput:
    date: dt.date
    is_holiday: bool  # explicit Holiday row
    is_override: bool  # WorkingDayOverride(is_working=True)
    holiday_name: str | None
    attendance: dict | None  # serialised Attendance row or None
    leave_sessions: list[str]  # any approved leave sessions covering this date


def derive_cell(inp: CellInput) -> dict:
    """Return {code, hours?, login?, logout?, location?, approval?, holiday_name?}."""
    a = inp.attendance
    has_punch_in = bool(a and a.get("login_time"))
    has_punch_out = bool(a and a.get("logout_time"))
    hours = _hours(a) if a else None

    # Priority order — first match wins (spec §Matrix view).
    if has_punch_in and not has_punch_out:
        return _cell("?", a, hours)
    # Admin manual override beats holiday / Sunday / leave-session rules
    # below so that pinning a cell from the Matrix UI is sticky regardless
    # of date type. Open-punch ('?') still wins because it represents a
    # data integrity issue the admin needs to fix at the source.
    if a and a.get("manual_status_override"):
        s = a.get("status")
        if s == "Present":
            return _cell("P", a, hours)
        if s == "Half Day":
            return _cell("H", a, hours)
        if s == "Leave":
            return {"code": "L"}
        if s == "Holiday":
            return {"code": "HD", "holiday_name": "Regional Holiday"}
        if s == "Absent":
            return _cell("A", a, hours)
    if inp.is_holiday or (inp.date.weekday() == calendar.SUNDAY and not inp.is_override):
        if a and has_punch_in:
            return _cell("HW", a, hours, holiday_name=inp.holiday_name or "Sunday")
        return {"code": "HD", "holiday_name": inp.holiday_name or "Sunday"}
    if a and a.get("work_location") == "WFH" and a.get("approval_state") == "Pending":
        return _cell("WP", a, hours)
    # Approved WFH renders as WFH when either:
    #   - the employee hasn't punched in yet (future-dated WFH that was
    #     materialised from a LeaveRequest; the day hasn't arrived or they
    #     haven't started work), OR
    #   - they did punch in and worked >= 4 hours.
    # The hours floor only kicks in once a punch exists so a < 4h WFH day
    # still falls through to Absent — same rule as office attendance.
    if a and a.get("work_location") == "WFH" and a.get("approval_state") == "Approved":
        if not has_punch_in or (hours or 0) >= 4:
            return _cell("WFH", a, hours)
    # Half-day leave + half-day work composite
    if "First Half" in inp.leave_sessions and a and a.get("status") == "Half Day":
        return _cell("L½+H", a, hours)
    if "Second Half" in inp.leave_sessions and a and a.get("status") == "Half Day":
        return _cell("L½+H", a, hours)
    if "Full" in inp.leave_sessions:
        return {"code": "L"}
    if any(s in inp.leave_sessions for s in ("First Half", "Second Half")):
        return {"code": "L½"}
    # Trust the stored ``status`` — Attendance._derive_status auto-derives it
    # from hours on save (>6h → Present, 4–6h → Half Day, <4h → Absent), and
    # an admin override is preserved via manual_status_override. Reading the
    # same field guarantees Log / Report / Matrix never disagree.
    if a:
        s = a.get("status")
        if s == "Present":
            return _cell("P", a, hours)
        if s == "Half Day":
            return _cell("H", a, hours)
        if s == "Leave":
            return {"code": "L"}
    return {"code": "A"}


def _cell(code: str, a: dict | None, hours: float | None, **extra) -> dict:
    if not a:
        return {"code": code, **extra}
    return {
        "code": code,
        "hours": hours,
        "login": a.get("login_time"),
        "logout": a.get("logout_time"),
        "location": a.get("work_location"),
        "approval": a.get("approval_state"),
        **extra,
    }


def _hours(a: dict) -> float | None:
    li = a.get("login_time")
    lo = a.get("logout_time")
    if not li or not lo:
        return None
    h1, m1, *_ = (int(p) for p in li.split(":"))
    h2, m2, *_ = (int(p) for p in lo.split(":"))
    delta = (h2 * 60 + m2) - (h1 * 60 + m1)
    return round(delta / 60, 2)


def build_matrix(*, employees, dates, attendance_rows, leave_rows, holidays, overrides) -> dict:
    """Assemble the matrix payload.

    All inputs are simple iterables — see view for assembly.
    """
    holiday_map = {h.date: h.name for h in holidays}
    override_dates = {o.date for o in overrides if o.is_working}

    # Reuse the holiday + override data we already fetched for the calendar
    # rendering — pass it into LeaveRequest.included_dates() to avoid 2 extra
    # DB queries per leave row.
    holiday_date_set = set(holiday_map.keys())
    override_full_map = {o.date: o.is_working for o in overrides}

    by_user_date: dict[tuple[int, dt.date], dict] = {}
    for r in attendance_rows:
        by_user_date[(r.user_id, r.date)] = {
            "login_time": r.login_time.strftime("%H:%M") if r.login_time else None,
            "logout_time": r.logout_time.strftime("%H:%M") if r.logout_time else None,
            "work_location": r.work_location,
            "approval_state": r.approval_state,
            "status": r.status,
            "leave_session": r.leave_session,
            "manual_status_override": r.manual_status_override,
        }

    leave_by_user: dict[int, list] = {}
    for lv in leave_rows:
        # Defensive: callers should pre-filter to Approved (the matrix view
        # does), but skip non-Approved rows here too in case build_matrix is
        # ever invoked with looser inputs.
        if lv.status != "Approved":
            continue
        # WFH-typed LeaveRequests materialise into Attendance rows via
        # core.leave.signals.materialise_attendance; the matrix renders
        # those through the work_location='WFH' branch of derive_cell.
        # Including them in leave_sessions would double-render them as
        # "L" and over-count the leave totals.
        if getattr(lv, "request_type", "Leave") == "WFH":
            continue
        for date, session in lv.included_dates(
            holiday_dates=holiday_date_set,
            override_map=override_full_map,
        ):
            # The materialised Attendance row is the source of truth for
            # "leave is in effect on this date". A 'Leave' row is the normal
            # case; a 'Half Day' row carries the half-day-work + half-leave
            # composite that derive_cell needs leave_sessions to render as
            # L½+H. Anything else (no row, or a row the admin replaced with
            # Present/Absent/etc.) means the leave was revoked for that
            # date — skip it so subsequent punches aren't masked by the
            # LeaveRequest's static range. The LeaveRequest itself is left
            # alone so the approval history is preserved.
            row = by_user_date.get((lv.user_id, date))
            if row is None or row.get("status") not in ("Leave", "Half Day"):
                continue
            leave_by_user.setdefault(lv.user_id, []).append((date, session))

    cells: dict[str, dict[str, dict]] = {}
    for emp in employees:
        emp_cells: dict[str, dict] = {}
        leaves = {(d, s) for (d, s) in leave_by_user.get(emp.id, [])}
        for d in dates:
            sessions = [s for (ld, s) in leaves if ld == d]
            inp = CellInput(
                date=d,
                is_holiday=d in holiday_map,
                is_override=d in override_dates,
                holiday_name=holiday_map.get(d),
                attendance=by_user_date.get((emp.id, d)),
                leave_sessions=sessions,
            )
            emp_cells[d.isoformat()] = derive_cell(inp)
        cells[str(emp.uid)] = emp_cells

    return {
        "employees": [
            {"uid": str(e.uid), "full_name": e.full_name, "org_uids": [str(o.uid) for o in e.orgs.all()]}
            for e in employees
        ],
        "dates": [
            {
                "date": d.isoformat(),
                "weekday": d.strftime("%a"),
                "is_holiday": d in holiday_map,
                "is_override": d in override_dates,
                "holiday_name": holiday_map.get(d),
            }
            for d in dates
        ],
        "cells": cells,
    }
