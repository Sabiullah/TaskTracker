"""Helpers for materializing recurring work-plan rows on the backend.

Mirrors the frontend ``generatePlanDates`` (utils/plan.ts) so series reshapes
performed via ``apply_to_following`` / ``promote_to_series`` produce the same
date sequence the Add Plan modal would.
"""

import calendar
import datetime


def generate_plan_dates(
    start: datetime.date,
    end: datetime.date,
    recurrence: str,
) -> list[datetime.date]:
    """Return the dates a series should occupy between ``start`` and ``end``.

    - ``daily``: every day, **Sundays skipped** (matches Add modal behavior).
    - ``weekly``: every 7 days starting at ``start``.
    - ``monthly``: 1 per month at the same day-of-month, clamped to the
      destination month's length (so e.g. day 31 → day 30 on Jun).

    Holidays are NOT filtered here — the worklog layer doesn't have direct
    access to the holiday calendar. Documented limitation; users delete
    materialized holiday rows manually.
    """
    if start > end:
        return []
    if recurrence == "daily":
        dates: list[datetime.date] = []
        cur = start
        while cur <= end:
            if cur.weekday() != 6:  # 6 == Sunday in Python (Monday=0)
                dates.append(cur)
            cur += datetime.timedelta(days=1)
        return dates
    if recurrence == "weekly":
        dates = []
        cur = start
        while cur <= end:
            dates.append(cur)
            cur += datetime.timedelta(days=7)
        return dates
    if recurrence == "monthly":
        dates = []
        day_of_month = start.day
        y, m = start.year, start.month
        while True:
            last_day = calendar.monthrange(y, m)[1]
            candidate = datetime.date(y, m, min(day_of_month, last_day))
            if candidate > end:
                break
            dates.append(candidate)
            m += 1
            if m > 12:
                m = 1
                y += 1
        return dates
    return []
