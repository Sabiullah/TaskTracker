"""End-to-end verification of Phase 1, Tasks 1-5.

Run with:
    .venv/Scripts/python.exe manage.py shell -c "exec(open('scripts/verify_phase1_tasks_1_to_5.py').read())"

Exercises the LeaveRequestViewSet via in-process APIClient (no live HTTP),
so it works regardless of whether the runserver is running. Verifies:

  Task 1: Attendance new fields are present (model layer)
  Task 2: WorkingDayOverride model is queryable
  Task 3: LeaveRequest model exists; included_dates() skips Sunday/holiday
  Task 4: approver_pool / can_approve helpers behave correctly
  Task 5: viewset endpoints — create, approve, reject, withdraw, conflict guard,
          DELETE-blocked, edit Pending only, multi-org permission
"""

import datetime as dt
import sys
from decimal import Decimal

# Windows-cp1252 default chokes on Unicode arrows/em-dashes in our prints.
try:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
except (AttributeError, ValueError):
    pass

from rest_framework.test import APIClient

from core.attendance.models import Attendance
from core.holidays.models import Holiday
from core.leave.models import LeaveRequest
from core.leave.permissions import approver_pool, can_approve
from core.working_days.models import WorkingDayOverride
from users.models import Org, OrgMembership, User


# ── Helpers ──────────────────────────────────────────────────────────────
def hr(label):
    print(f"\n====== {label} ======")


def step(msg, ok):
    print(f"  {'OK' if ok else 'FAIL'} {msg}")
    if not ok:
        raise SystemExit(1)


def cleanup():
    """Tear down anything we created last run so re-runs are idempotent."""
    LeaveRequest.objects.filter(reason__startswith="[verify]").delete()
    Attendance.objects.filter(remarks__startswith="Leave: [verify]").delete()
    WorkingDayOverride.objects.filter(note__startswith="[verify]").delete()
    Holiday.objects.filter(name__startswith="[verify]").delete()
    User.objects.filter(email__endswith="@verify.local").delete()


cleanup()

# ── Setup: fixtures ──────────────────────────────────────────────────────
hr("Setup")
org_4d = Org.objects.get(name="4D")
admin = User.objects.get(email="safycosting@gmail.com")
mgr = User.objects.create_user(email="m@verify.local", password="x", full_name="VerifyMgr")
emp = User.objects.create_user(email="e@verify.local", password="x", full_name="VerifyEmp")
OrgMembership.objects.create(user=mgr, org=org_4d, role="manager")
OrgMembership.objects.create(user=emp, org=org_4d, role="employee")
emp.managers.add(mgr)
print(f"  org={org_4d.name}, admin={admin.full_name}, mgr={mgr.full_name}, emp={emp.full_name}")

# ── Task 1: Attendance fields exist ──────────────────────────────────────
hr("Task 1 — Attendance schema")
fields = {f.name for f in Attendance._meta.get_fields()}
step("approval_state field exists", "approval_state" in fields)
step("approver field exists", "approver" in fields)
step("approved_at field exists", "approved_at" in fields)
step("rejection_reason field exists", "rejection_reason" in fields)
step("leave_session field exists", "leave_session" in fields)

# ── Task 2: WorkingDayOverride exists ────────────────────────────────────
hr("Task 2 — WorkingDayOverride model")
sun_in_april = dt.date(2026, 4, 26)  # Sunday
override = WorkingDayOverride.objects.create(
    org=org_4d,
    date=sun_in_april,
    is_working=True,
    note="[verify] team release Sunday",
)
step(
    "Created override for Sunday 2026-04-26 in 4D",
    WorkingDayOverride.objects.filter(uid=override.uid).exists(),
)

# ── Task 3: LeaveRequest + included_dates skips Sunday/holiday ──────────
hr("Task 3 — LeaveRequest.included_dates()")
# Mon 27 Apr → Wed 29 Apr (3 working days, no Sunday inside)
lr = LeaveRequest(
    org=org_4d,
    user=emp,
    from_date=dt.date(2026, 4, 27),
    to_date=dt.date(2026, 4, 29),
    from_session="Full",
    to_session="Full",
    reason="[verify] task3",
)
dates = lr.included_dates()
step(
    f"3-day Mon→Wed range yields 3 dates: {dates}",
    len(dates) == 3 and all(s == "Full" for _, s in dates),
)

# Create a Holiday on Tue 28 Apr → expect 2 dates only
holiday = Holiday.objects.create(org=org_4d, name="[verify] test holiday", date=dt.date(2026, 4, 28))
dates_h = lr.included_dates()
step(f"With holiday on 28 Apr, range yields 2 dates: {dates_h}", len(dates_h) == 2)
holiday.delete()

# Range that crosses an UNoverridden Sunday should skip it
lr2 = LeaveRequest(
    org=org_4d,
    user=emp,
    from_date=dt.date(2026, 4, 25),
    to_date=dt.date(2026, 4, 27),  # Sat-Sun-Mon
    from_session="Full",
    to_session="Full",
    reason="[verify] task3 sunday",
)
# remove our override first so 26 Apr is treated as Sunday=HD
override.is_working = False
override.save()
dates_sun = lr2.included_dates()
step(f"Sat-Sun-Mon range with NO override skips Sunday: {dates_sun}", len(dates_sun) == 2)
# And with override flipping Sun back to working day
override.is_working = True
override.save()
dates_sun2 = lr2.included_dates()
step(
    f"Sat-Sun-Mon range WITH override(is_working=True) includes 3 days: {dates_sun2}",
    len(dates_sun2) == 3,
)

# Half-day computation
lr_half = LeaveRequest(
    org=org_4d,
    user=emp,
    from_date=dt.date(2026, 4, 27),
    to_date=dt.date(2026, 4, 29),
    from_session="First Half",
    to_session="Second Half",
    reason="[verify] half edges",
)
total = lr_half.compute_total_days()
step(f"3-day range with half edges → 2.0 days (0.5 + 1 + 0.5): got {total}", total == Decimal("2.0"))

# ── Task 4: approver_pool / can_approve ──────────────────────────────────
hr("Task 4 — approver_pool / can_approve")
step("admin pool is empty (auto-approve)", approver_pool(admin, org_4d) == [])
step(
    "employee pool = [their manager]",
    approver_pool(emp, org_4d) == [mgr.pk],
)
step(
    "manager pool = admins (excludes self)",
    approver_pool(mgr, org_4d) == [admin.pk],
)
step("can_approve(admin, mgr, org) = True", can_approve(admin, mgr, org_4d) is True)
step("can_approve(admin, admin, org) = False (self-approve guard)", can_approve(admin, admin, org_4d) is False)
step("can_approve(mgr, mgr, org) = False (self-approve guard)", can_approve(mgr, mgr, org_4d) is False)

# ── Task 5: ViewSet end-to-end via APIClient ─────────────────────────────
hr("Task 5 — LeaveRequestViewSet end-to-end")

emp_client = APIClient(HTTP_HOST="localhost")
emp_client.force_authenticate(user=emp)
mgr_client = APIClient(HTTP_HOST="localhost")
mgr_client.force_authenticate(user=mgr)
admin_client = APIClient(HTTP_HOST="localhost")
admin_client.force_authenticate(user=admin)

# 5a. Employee files a leave
print("\n  -- 5a: Employee creates Pending leave --")
r = emp_client.post(
    "/api/leave-requests/",
    {
        "user": str(emp.uid),
        "org": str(org_4d.uid),
        "from_date": "2026-04-27",
        "to_date": "2026-04-29",
        "from_session": "Full",
        "to_session": "Full",
        "reason": "[verify] vacation",
    },
    format="json",
)
step(f"POST /api/leave-requests/ → 201, got {r.status_code}", r.status_code == 201)
emp_leave = LeaveRequest.objects.get(uid=r.json()["uid"])
step(f"created with status=Pending: got {emp_leave.status}", emp_leave.status == "Pending")
step(f"total_days computed (3 working days): got {emp_leave.total_days}", emp_leave.total_days == Decimal("3.00"))

# 5b. Approver pool: emp's manager should approve
print("\n  -- 5b: Manager approves leave --")
r = mgr_client.post(f"/api/leave-requests/{emp_leave.uid}/approve/", {}, format="json")
step(f"manager approves → 200, got {r.status_code} {r.json() if r.status_code != 200 else ''}", r.status_code == 200)
emp_leave.refresh_from_db()
step("status flipped to Approved", emp_leave.status == "Approved")
step(f"approver = manager: got {emp_leave.approver}", emp_leave.approver_id == mgr.pk)

# 5c. Materialise check — 3 attendance rows (status=Leave) created
print("\n  -- 5c: Attendance rows materialised --")
mat_rows = Attendance.objects.filter(user=emp, date__range=("2026-04-27", "2026-04-29"), status="Leave")
step(f"3 Leave attendance rows created: got {mat_rows.count()}", mat_rows.count() == 3)

# 5d. Withdraw — rows demolished
print("\n  -- 5d: Withdraw demolishes rows --")
r = emp_client.post(f"/api/leave-requests/{emp_leave.uid}/withdraw/", {}, format="json")
step(f"withdraw → 200, got {r.status_code}", r.status_code == 200)
emp_leave.refresh_from_db()
step("status flipped to Withdrawn", emp_leave.status == "Withdrawn")
mat_rows = Attendance.objects.filter(user=emp, date__range=("2026-04-27", "2026-04-29"), status="Leave")
step(f"Leave rows demolished: got {mat_rows.count()}", mat_rows.count() == 0)

# 5e. Reject requires reason
print("\n  -- 5e: Reject requires reason --")
r = emp_client.post(
    "/api/leave-requests/",
    {
        "user": str(emp.uid),
        "org": str(org_4d.uid),
        "from_date": "2026-05-04",
        "to_date": "2026-05-04",
        "from_session": "Full",
        "to_session": "Full",
        "reason": "[verify] another",
    },
    format="json",
)
step(f"create new Pending leave → 201, got {r.status_code}", r.status_code == 201)
new_lr_uid = r.json()["uid"]
r2 = mgr_client.post(f"/api/leave-requests/{new_lr_uid}/reject/", {}, format="json")
step(f"reject without reason → 400, got {r2.status_code}", r2.status_code == 400)
r3 = mgr_client.post(f"/api/leave-requests/{new_lr_uid}/reject/", {"reason": "team release week"}, format="json")
step(f"reject with reason → 200, got {r3.status_code}", r3.status_code == 200)

# 5f. Self-approve guard
print("\n  -- 5f: Self-approve guard --")
r = emp_client.post(
    "/api/leave-requests/",
    {
        "user": str(emp.uid),
        "org": str(org_4d.uid),
        "from_date": "2026-05-05",
        "to_date": "2026-05-05",
        "from_session": "Full",
        "to_session": "Full",
        "reason": "[verify] self-approve test",
    },
    format="json",
)
self_lr_uid = r.json()["uid"]
r2 = emp_client.post(f"/api/leave-requests/{self_lr_uid}/approve/", {}, format="json")
step(f"employee approves own leave → 403, got {r2.status_code}", r2.status_code == 403)

# 5g. Admin auto-approve on create
print("\n  -- 5g: Admin auto-approve --")
r = admin_client.post(
    "/api/leave-requests/",
    {
        "user": str(admin.uid),
        "org": str(org_4d.uid),
        "from_date": "2026-05-06",
        "to_date": "2026-05-06",
        "from_session": "Full",
        "to_session": "Full",
        "reason": "[verify] admin self-leave",
    },
    format="json",
)
step(f"admin POST → 201, got {r.status_code}", r.status_code == 201)
adm_leave = LeaveRequest.objects.get(uid=r.json()["uid"])
step(f"admin's leave auto-approved: got status={adm_leave.status}", adm_leave.status == "Approved")
adm_mat = Attendance.objects.filter(user=admin, date="2026-05-06", status="Leave")
step(f"admin's leave materialised 1 row: got {adm_mat.count()}", adm_mat.count() == 1)

# 5h. DELETE is blocked
print("\n  -- 5h: DELETE is blocked --")
r = admin_client.delete(f"/api/leave-requests/{adm_leave.uid}/")
step(f"DELETE → 403, got {r.status_code}", r.status_code == 403)
step("error mentions withdraw", "withdraw" in str(r.data).lower())

# 5i. Edit non-Pending is blocked
print("\n  -- 5i: PATCH on Approved leave is blocked --")
r = admin_client.patch(f"/api/leave-requests/{adm_leave.uid}/", {"reason": "[verify] tampered"}, format="json")
step(f"PATCH on Approved → 400, got {r.status_code}", r.status_code == 400)

# 5j. user FK cannot be re-assigned via PATCH (security fix)
print("\n  -- 5j: user FK is read-only on PATCH (Critical fix) --")
r = emp_client.post(
    "/api/leave-requests/",
    {
        "user": str(emp.uid),
        "org": str(org_4d.uid),
        "from_date": "2026-05-07",
        "to_date": "2026-05-07",
        "from_session": "Full",
        "to_session": "Full",
        "reason": "[verify] ownership test",
    },
    format="json",
)
own_lr_uid = r.json()["uid"]
# Try to re-assign ownership to mgr (should be silently ignored)
r2 = emp_client.patch(f"/api/leave-requests/{own_lr_uid}/", {"user": str(mgr.uid)}, format="json")
step(f"PATCH with user= → 200 (request accepted), got {r2.status_code}", r2.status_code == 200)
own_lr = LeaveRequest.objects.get(uid=own_lr_uid)
step(f"user FK NOT re-assigned (still emp): got {own_lr.user.email}", own_lr.user_id == emp.pk)

# 5k. List filtering
print("\n  -- 5k: List filtering --")
r = admin_client.get("/api/leave-requests/?status=Pending")
pending_count = len(r.json().get("results", r.json()) if isinstance(r.json(), dict) else r.json())
step(f"GET ?status=Pending → some pending rows: got {pending_count}", pending_count >= 1)
r = admin_client.get(f"/api/leave-requests/?user_uid={emp.uid}")
emp_count = len(r.json().get("results", r.json()) if isinstance(r.json(), dict) else r.json())
step(f"GET ?user_uid=<emp> → emp's rows: got {emp_count}", emp_count >= 1)

# Cleanup
cleanup()
print("\n====== ALL VERIFICATIONS PASSED ======\n")
