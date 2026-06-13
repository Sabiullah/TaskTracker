"""Single source of truth for the menu/submenu tree used by the User Rights
matrix and by nav/tab gating. Add a menu here and both the matrix rows and the
``/api/menu-catalog/`` payload pick it up automatically.

``code`` is the stable identifier persisted on ``MenuRight.menu_code`` — do NOT
rename an existing code without a data migration. Submenu codes are dotted
under their parent (``employee.salary``). Parents MUST precede their children.
"""

from typing import NamedTuple


class MenuNode(NamedTuple):
    code: str
    label: str
    parent: str | None  # None for top-level menus


MENU_CATALOG: list[MenuNode] = [
    MenuNode("board", "Board", None),
    MenuNode("dashboard", "Dashboard", None),
    MenuNode("calendar", "Calendar", None),
    MenuNode("worklog", "Work Log", None),
    MenuNode("worklog.log", "Log Table", "worklog"),
    MenuNode("worklog.plan", "Work Plan", "worklog"),
    MenuNode("worklog.dashboard", "Dashboard", "worklog"),
    MenuNode("leads", "Leads", None),
    MenuNode("leads.open", "Open", "leads"),
    MenuNode("leads.confirmed", "Confirmed", "leads"),
    MenuNode("leads.cancelled", "Cancelled", "leads"),
    MenuNode("clients", "Clients", None),
    MenuNode("clients.roadmap", "Road Map", "clients"),
    MenuNode("clients.mom", "MOM & Action Points", "clients"),
    MenuNode("clients.observation", "Observation Report", "clients"),
    MenuNode("clients.audit", "Internal Audit Report", "clients"),
    MenuNode("notice", "Notice", None),
    MenuNode("notice.open", "Open", "notice"),
    MenuNode("notice.completed", "Completed", "notice"),
    MenuNode("invoice", "Invoice", None),
    MenuNode("invoice.schedule", "Schedule", "invoice"),
    MenuNode("invoice.summary", "Summary", "invoice"),
    MenuNode("invoice.invoices", "Invoices", "invoice"),
    MenuNode("invoice.report", "Report", "invoice"),
    MenuNode("conveyance", "Conveyance", None),
    MenuNode("conveyance.transactions", "Transactions", "conveyance"),
    MenuNode("conveyance.employee_totals", "Employee Totals", "conveyance"),
    MenuNode("conveyance.client_totals", "Client Totals", "conveyance"),
    MenuNode("masters", "Masters", None),
    MenuNode("masters.orgs", "Organizations", "masters"),
    MenuNode("masters.clients", "Clients", "masters"),
    MenuNode("masters.categories", "Categories", "masters"),
    MenuNode("masters.team", "Team Members", "masters"),
    MenuNode("holidays", "Holidays", None),
    MenuNode("holidays.holidays", "Holidays", "holidays"),
    MenuNode("holidays.working_days", "Working Days", "holidays"),
    MenuNode("employee", "Employee", None),
    MenuNode("employee.personal", "Personal Info", "employee"),
    MenuNode("employee.salary", "Salary", "employee"),
    MenuNode("employee.leave", "Leave", "employee"),
    MenuNode("employee.matrix", "Matrix", "employee"),
    MenuNode("employee.attendance_log", "Attendance Log", "employee"),
    MenuNode("employee.approvals", "Approvals", "employee"),
    MenuNode("pace", "PACE", None),
    MenuNode("pace.meetings", "Meetings", "pace"),
    MenuNode("pace.standup", "Daily Standup", "pace"),
    MenuNode("pace.goals", "Goals", "pace"),
    MenuNode("pace.classification", "Client Classification", "pace"),
    MenuNode("pace.checklist", "Checklist", "pace"),
    MenuNode("growthplan", "Growth Plan", None),
    MenuNode("kaizen", "Kaizen", None),
    MenuNode("users", "Users", None),
    MenuNode("settings", "Settings", None),
]

ALL_CODES: set[str] = {n.code for n in MENU_CATALOG}

# Menus every member can see by default (mirrors the nav that was always shown
# before per-menu rights existed). New non-admin memberships are seeded with
# view on these so they are never left with an empty nav. ``growthplan`` and
# ``users`` are intentionally excluded — they stay admin-only.
ALWAYS_ON_VIEW: list[str] = [
    "board",
    "dashboard",
    "calendar",
    "worklog",
    "conveyance",
    "holidays",
    "employee",
    "pace",
    "kaizen",
    "settings",
]

# Maps the legacy 7 OrgMembership boolean flags onto the catalog code that now
# represents them. Used by the backfill migration and the compat helpers.
FEATURE_TO_CODE: dict[str, str] = {
    "invoice_access": "invoice",
    "notice_access": "notice",
    "masters_access": "masters",
    "attendance_access": "employee.attendance_log",
    "employee_access": "employee",
    "leads_access": "leads",
    "conveyance_access": "conveyance",
}


def top_level_code(code: str) -> str:
    """The parent menu code for any code (``employee.salary`` -> ``employee``)."""
    return code.split(".", 1)[0]


def children_of(parent: str) -> list[MenuNode]:
    return [n for n in MENU_CATALOG if n.parent == parent]
