"""Regression: dashboard comp-date edits must persist regardless of how the
row's ``status`` was stored.

A normal user setting Completed Date on an overdue sub-task from the dashboard
drill-down PATCHes ``/api/tasks/<uid>/`` with ``{completed_date: ...}`` and no
``status``. The serializer derives the status from the dates. Rows whose stored
status was a legacy display label ("Overdue") or empty used to hit an early
return in ``_auto_align_status_with_dates`` that normalized the label but SKIPPED
the date-based derivation — leaving ``completed_date`` set on a non-completed
status, which ``full_clean`` rejected with 400. The edit silently failed to
persist; reopening (or a fresh browser) still showed the task as overdue.
"""

import datetime as dt

from django.test import TestCase
from rest_framework.test import APIClient

from core.masters.models import Master
from core.tasks.models import Task
from users.models import Org, OrgMembership, User


class CompDatePersistsAcrossLegacyStatusTests(TestCase):
    def _make_employee_subtask(self, sub_status):
        org = Org.objects.create(name="Acme")
        admin = User.objects.create_user(username="adm", password="pw", full_name="Admin")
        OrgMembership.objects.create(user=admin, org=org, role="admin")
        emp = User.objects.create_user(username="emp", password="pw", full_name="Emp One")
        OrgMembership.objects.create(user=emp, org=org, role="employee")
        client = Master.objects.create(name="JMS", type="client", org=org)
        cat = Master.objects.create(name="Custom DB", type="category", org=org, recurrence="Monthly", target_day=2)
        main = Task.objects.create(
            description="Main goal", org=org, client=client,
            reporting_manager=admin, responsible=admin, target_date=dt.date(2026, 6, 2),
        )
        # ``objects.create`` bypasses ``full_clean`` so we can plant a row with
        # a legacy/invalid status the way production data did.
        sub = Task.objects.create(
            description="P&L Data Collection - Sales", org=org, client=client,
            category=cat, parent=main, reporting_manager=admin, responsible=emp,
            target_date=dt.date(2026, 6, 2), status=sub_status,
        )
        return emp, sub

    def _patch_completed_date(self, emp, sub):
        api = APIClient()
        api.force_authenticate(user=emp)
        resp = api.patch(
            f"/api/tasks/{sub.uid}/",
            {"expected_date": None, "completed_date": "2026-06-02", "remarks": ""},
            format="json",
        )
        sub.refresh_from_db()
        return resp

    def _assert_persists(self, sub_status):
        emp, sub = self._make_employee_subtask(sub_status)
        resp = self._patch_completed_date(emp, sub)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(sub.completed_date, dt.date(2026, 6, 2))
        self.assertIn(sub.status, Task.COMPLETED_STATUSES)
        # The 200 response must carry the persisted value so the client store
        # reconciles correctly (the dashboard count is derived from it).
        self.assertEqual(resp.data["completed_date"], "2026-06-02")

    def test_persists_for_pending_key(self):
        self._assert_persists("pending")

    def test_persists_for_overdue_key(self):
        self._assert_persists("overdue")

    def test_persists_for_legacy_display_label(self):
        # The exact production case: status stored as the display label.
        self._assert_persists("Overdue")

    def test_persists_for_empty_status(self):
        self._assert_persists("")
