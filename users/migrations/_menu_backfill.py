"""Pure backfill logic shared by the data migration and its tests.

Takes the ``MenuRight`` model class (so it works with the historical model
inside a migration's ``apps.get_model``) and one membership instance.
"""

FEATURE_TO_CODE = {
    "invoice_access": "invoice",
    "notice_access": "notice",
    "masters_access": "masters",
    "attendance_access": "employee.attendance_log",
    "employee_access": "employee",
    "leads_access": "leads",
    "conveyance_access": "conveyance",
}

ALWAYS_ON_VIEW = [
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

# Submenus that should mirror their parent's level when the parent is granted.
SUBMENUS = {
    "worklog": ["worklog.log", "worklog.plan", "worklog.dashboard"],
    "leads": ["leads.open", "leads.confirmed", "leads.cancelled"],
    "clients": ["clients.roadmap", "clients.mom", "clients.observation", "clients.audit"],
    "notice": ["notice.open", "notice.completed"],
    "invoice": ["invoice.schedule", "invoice.summary", "invoice.invoices", "invoice.report"],
    "conveyance": ["conveyance.transactions", "conveyance.employee_totals", "conveyance.client_totals"],
    "masters": ["masters.orgs", "masters.clients", "masters.categories", "masters.team"],
    "holidays": ["holidays.holidays", "holidays.working_days"],
    "employee": [
        "employee.personal",
        "employee.salary",
        "employee.leave",
        "employee.matrix",
        "employee.attendance_log",
        "employee.approvals",
    ],
    "pace": ["pace.meetings", "pace.standup", "pace.goals", "pace.classification", "pace.checklist"],
}


def _grant(MenuRight, membership, code, view, edit):
    """Upsert, OR-ing the new levels onto any existing row (edit implies view)."""
    edit = bool(edit)
    view = bool(view) or edit
    row, created = MenuRight.objects.get_or_create(
        membership=membership,
        menu_code=code,
        defaults={"can_view": view, "can_edit": edit},
    )
    if not created:
        changed = False
        if view and not row.can_view:
            row.can_view = True
            changed = True
        if edit and not row.can_edit:
            row.can_edit, row.can_view = True, True
            changed = True
        if changed:
            row.save()


def seed_membership_rights(MenuRight, membership):
    if membership.role == "admin":
        return  # admins bypass the matrix entirely

    # 1. Always-on menus -> view (parent + submenus).
    for code in ALWAYS_ON_VIEW:
        _grant(MenuRight, membership, code, view=True, edit=False)
        for sub in SUBMENUS.get(code, []):
            _grant(MenuRight, membership, sub, view=True, edit=False)

    # 2. Legacy flags -> their menu at view+edit (parent + submenus).
    for feature, code in FEATURE_TO_CODE.items():
        if not getattr(membership, feature, False):
            continue
        parent = code.split(".", 1)[0]
        _grant(MenuRight, membership, code, view=True, edit=True)
        _grant(MenuRight, membership, parent, view=True, edit=True)
        for sub in SUBMENUS.get(parent, []):
            _grant(MenuRight, membership, sub, view=True, edit=True)
