"""Verify Task 6 — WorkingDayOverrideViewSet end-to-end."""
import sys
try:
    sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass

from rest_framework.test import APIClient

from core.working_days.models import WorkingDayOverride
from users.models import Org, User


def step(msg, ok):
    print(f"  {'OK' if ok else 'FAIL'} {msg}")
    if not ok:
        raise SystemExit(1)


# Cleanup any prior runs
WorkingDayOverride.objects.filter(note__startswith="[verify6]").delete()

org = Org.objects.get(name="4D")
admin = User.objects.get(email="safycosting@gmail.com")
employee = User.objects.filter(memberships__role="employee", memberships__org=org).first()
assert employee is not None, "Need at least one employee in 4D for the test"

admin_client = APIClient(HTTP_HOST="localhost"); admin_client.force_authenticate(user=admin)
emp_client = APIClient(HTTP_HOST="localhost"); emp_client.force_authenticate(user=employee)

print("====== Task 6 — WorkingDayOverrideViewSet ======")

# 6a. Admin can create
r = admin_client.post("/api/working-day-overrides/", {
    "date": "2026-04-26", "is_working": True, "note": "[verify6] release Sunday", "org": str(org.uid),
}, format="json")
step(f"admin POST → 201, got {r.status_code}: {r.json() if r.status_code != 201 else ''}", r.status_code == 201)
override_uid = r.json()["uid"]

# 6b. Admin can list
r = admin_client.get("/api/working-day-overrides/")
items = r.json() if isinstance(r.json(), list) else r.json().get("results", r.json())
step(f"admin GET list → 200 with our row visible: got {r.status_code}", r.status_code == 200 and any(i.get("uid") == override_uid for i in items))

# 6c. Employee CAN list (read scoped via `scoped()`)
r = emp_client.get("/api/working-day-overrides/")
step(f"employee GET list → 200, got {r.status_code}", r.status_code == 200)

# 6d. Employee CANNOT create (admin-only)
r = emp_client.post("/api/working-day-overrides/", {
    "date": "2026-05-03", "is_working": True, "note": "[verify6] employee try", "org": str(org.uid),
}, format="json")
step(f"employee POST → 403 (admin-only), got {r.status_code}: {r.json() if r.status_code != 403 else ''}", r.status_code == 403)

# 6e. Year filter
r = admin_client.get("/api/working-day-overrides/?year=2026")
items = r.json() if isinstance(r.json(), list) else r.json().get("results", r.json())
step(f"admin GET ?year=2026 → 200 with our row: got {r.status_code}", r.status_code == 200 and any(i.get("uid") == override_uid for i in items))

# 6f. Admin can DELETE
r = admin_client.delete(f"/api/working-day-overrides/{override_uid}/")
step(f"admin DELETE → 204, got {r.status_code}", r.status_code == 204)
step("row deleted from DB", not WorkingDayOverride.objects.filter(uid=override_uid).exists())

print("\n====== Task 6 ALL GREEN ======\n")
