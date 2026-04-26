"""End-to-end smoke test for /api/attendance/matrix/."""

import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
except (AttributeError, ValueError):
    pass

from rest_framework.test import APIClient

from users.models import User


def step(msg, ok):
    print(f"  {'OK' if ok else 'FAIL'} {msg}")
    if not ok:
        raise SystemExit(1)


admin = User.objects.get(email="safycosting@gmail.com")
c = APIClient(HTTP_HOST="localhost")
c.force_authenticate(user=admin)

print("====== Task 15 — /api/attendance/matrix/ ======")

# 15a. Missing month → 400
r = c.get("/api/attendance/matrix/")
step(f"GET without month → 400, got {r.status_code}", r.status_code == 400)

# 15b. Bad month → 400
r = c.get("/api/attendance/matrix/?month=2026-XX")
step(f"GET with invalid month → 400, got {r.status_code}", r.status_code == 400)

# 15c. Valid month → 200 with shape
r = c.get("/api/attendance/matrix/?month=2026-04")
step(f"GET ?month=2026-04 → 200, got {r.status_code}", r.status_code == 200)

payload = r.json()
step(
    "payload has employees + dates + cells keys",
    set(payload.keys()) >= {"employees", "dates", "cells"},
)
step(f"30 dates in April: got {len(payload['dates'])}", len(payload["dates"]) == 30)
step(
    "first date is 2026-04-01",
    payload["dates"][0]["date"] == "2026-04-01",
)
step(
    "Apr 26 (Sunday) is_holiday OR weekday=Sun renders HD when no override",
    any(d["date"] == "2026-04-26" and d["weekday"] == "Sun" for d in payload["dates"]),
)

# 15d. The admin (Safy) is in the matrix; her cells dict is keyed by date
step(
    "admin's row appears in employees",
    any(e["full_name"] == "Safy" for e in payload["employees"]),
)
admin_cells = payload["cells"].get(str(admin.uid))
step(f"admin has cells dict: got {bool(admin_cells)}", bool(admin_cells))
if admin_cells:
    step(
        "Sunday 2026-04-26 cell code is 'HD' for admin",
        admin_cells.get("2026-04-26", {}).get("code") == "HD",
    )

print("\n====== Task 15 ALL GREEN ======\n")
