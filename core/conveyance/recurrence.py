"""Period-date computation for recurring Conveyance entries.

Pure functions only — no DB, no Django imports. Kept in its own module so
the materialiser in ``views.py`` and the serializer's cross-field validator
can both import without a circular dependency.
"""

import datetime
from typing import List

# Step in months for each frequency. ``one_time`` is special-cased.
_STEP_MONTHS = {
    "monthly": 1,
    "half_yearly": 6,
    "yearly": 12,
}


def _first_of_month(d: datetime.date) -> datetime.date:
    return d.replace(day=1)


def _add_months(d: datetime.date, n: int) -> datetime.date:
    """Return d shifted by n months, snapped to the 1st."""
    total = d.year * 12 + (d.month - 1) + n
    year, month0 = divmod(total, 12)
    return datetime.date(year, month0 + 1, 1)


def period_dates(
    frequency: str,
    start_month: datetime.date,
    end_month: datetime.date,
) -> List[datetime.date]:
    """Return the list of period-start dates (1st of month) for the series.

    - ``one_time`` returns ``[start_month]`` snapped to the 1st.
    - Recurring frequencies step from start to end inclusive; if end < start
      the result is ``[]``.
    - Unknown frequency raises ``ValueError``.
    """
    start = _first_of_month(start_month)
    end = _first_of_month(end_month)

    if frequency == "one_time":
        return [start]
    if frequency not in _STEP_MONTHS:
        raise ValueError(f"Unknown frequency: {frequency!r}")
    if end < start:
        return []

    step = _STEP_MONTHS[frequency]
    out: List[datetime.date] = []
    cursor = start
    while cursor <= end:
        out.append(cursor)
        cursor = _add_months(cursor, step)
    return out
