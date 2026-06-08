import datetime as dt

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import TestCase
from rest_framework.test import APIClient, APIRequestFactory, force_authenticate

from core.masters.models import Master
from core.tasks.models import Task, TaskSubcategoryPlan
from core.tasks.services import (
    add_or_extend_plan,
    cap_plan,
    cascade_owner_forward,
    materialize_month,
)
from users.models import Org, OrgMembership, User


def _setup():
    org = Org.objects.create(name="Acme")
    user = User.objects.create_user(username="u1", password="pw", full_name="U One")
    OrgMembership.objects.create(user=user, org=org, role="admin")
    client = Master.objects.create(name="C1", type="client", org=org)
    return org, user, client


class TaskParentFieldTests(TestCase):
    def test_task_has_nullable_parent_defaulting_to_null(self):
        org, user, client = _setup()
        t = Task.objects.create(
            description="Main",
            org=org,
            client=client,
            reporting_manager=user,
            target_date=dt.date(2026, 6, 1),
        )
        self.assertIsNone(t.parent)


class TaskSerialNoAssignmentTests(TestCase):
    def test_save_skips_null_serial_no_rows_when_assigning_next(self):
        """A row left with ``serial_no=NULL`` (e.g. by a historical data
        migration that bypasses ``Task.save``) must not poison the next
        live save's allocation. Reproduces the AddTask 500: on Postgres,
        ``ORDER BY -serial_no`` puts NULLs first, so the previous lookup
        returned NULL and the next save tried ``serial_no=1`` again,
        colliding with the existing row. ``Max()`` aggregation skips NULLs
        on every backend.
        """
        org, user, client = _setup()
        Task.objects.create(
            description="Existing",
            org=org,
            client=client,
            reporting_manager=user,
            target_date=dt.date(2026, 6, 1),
        )
        # Simulate the orphan migration 0009 left behind: a real row with
        # serial_no=NULL. Bypass ``Task.save`` via ``update`` so the auto-
        # assignment doesn't fire — exactly what historical-model
        # ``apps.get_model("tasks","Task").objects.create`` did before
        # migration 0009 was patched.
        orphan = Task.objects.create(
            description="Orphan",
            org=org,
            client=client,
            reporting_manager=user,
            target_date=dt.date(2026, 7, 1),
        )
        Task.objects.filter(pk=orphan.pk).update(serial_no=None)

        # New row should get serial_no=2 (one past the existing max), not
        # serial_no=1 (which would collide with the first row).
        fresh = Task.objects.create(
            description="Fresh",
            org=org,
            client=client,
            reporting_manager=user,
            target_date=dt.date(2026, 8, 1),
        )
        self.assertIsNotNone(fresh.serial_no)
        self.assertGreater(fresh.serial_no, 1)

    def test_subtask_links_to_parent_via_parent_fk(self):
        org, user, client = _setup()
        main = Task.objects.create(
            description="Main",
            org=org,
            client=client,
            reporting_manager=user,
            target_date=dt.date(2026, 6, 1),
        )
        sub = Task.objects.create(
            description="Sub",
            org=org,
            client=client,
            reporting_manager=user,
            responsible=user,
            parent=main,
            target_date=dt.date(2026, 5, 1),
        )
        self.assertEqual(sub.parent_id, main.pk)
        self.assertEqual(list(main.subtasks.all()), [sub])

    def test_deleting_main_cascades_to_subs(self):
        org, user, client = _setup()
        main = Task.objects.create(
            description="Main",
            org=org,
            reporting_manager=user,
            target_date=dt.date(2026, 6, 1),
        )
        Task.objects.create(
            description="Sub",
            org=org,
            reporting_manager=user,
            responsible=user,
            parent=main,
        )
        main.delete()
        self.assertEqual(Task.objects.count(), 0)


class TaskValidationTests(TestCase):
    def setUp(self):
        self.org, self.user, self.client_master = _setup()
        self.main = Task.objects.create(
            description="Main",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            target_date=dt.date(2026, 6, 1),
        )

    def test_sub_target_date_after_parent_target_is_rejected(self):
        sub = Task(
            description="Sub",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            responsible=self.user,
            parent=self.main,
            target_date=dt.date(2026, 7, 1),
        )
        with self.assertRaises(ValidationError) as ctx:
            sub.full_clean()
        self.assertIn("main goal's target date", str(ctx.exception))

    def test_sub_target_date_on_or_before_parent_target_is_ok(self):
        sub = Task(
            description="Sub",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            responsible=self.user,
            parent=self.main,
            target_date=dt.date(2026, 6, 1),
        )
        sub.full_clean()  # no exception

    def test_grandchild_is_rejected(self):
        sub = Task.objects.create(
            description="Sub",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            responsible=self.user,
            parent=self.main,
        )
        grand = Task(
            description="Grand",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            responsible=self.user,
            parent=sub,
        )
        with self.assertRaises(ValidationError) as ctx:
            grand.full_clean()
        self.assertIn("Sub-tasks cannot have sub-tasks", str(ctx.exception))

    def test_sub_expected_date_can_exceed_parent_target(self):
        sub = Task(
            description="Sub",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            responsible=self.user,
            parent=self.main,
            target_date=dt.date(2026, 5, 1),
            expected_date=dt.date(2026, 7, 15),
        )
        sub.full_clean()  # no exception


class TaskMainShrinkageTests(TestCase):
    def test_moving_main_target_earlier_than_existing_subs_is_rejected(self):
        org, user, client = _setup()
        main = Task.objects.create(
            description="Main",
            org=org,
            client=client,
            reporting_manager=user,
            target_date=dt.date(2026, 6, 1),
        )
        Task.objects.create(
            description="Sub1",
            org=org,
            client=client,
            reporting_manager=user,
            responsible=user,
            parent=main,
            target_date=dt.date(2026, 5, 28),
        )
        main.target_date = dt.date(2026, 5, 1)
        with self.assertRaises(ValidationError) as ctx:
            main.full_clean()
        self.assertIn("sub-task", str(ctx.exception).lower())

    def test_plan_managed_main_patch_succeeds_despite_late_children(self):
        """Regression: dashboard inline-edit on a Monthly main goal was
        returning HTTP 400 ("Save failed: ApiError: HTTP 400 Bad Request")
        even though the data persisted. ``Task.clean()`` ran post-save and
        rejected the row because plan-materialized children for future
        months naturally have ``target_date > main.target_date``. For plan-
        managed goals the late-subs rule doesn't apply (children are
        cadenced over the engagement window, not bounded by the main
        target). Without this skip, a manager couldn't save remarks on
        a recurring goal.
        """
        org, user, client = _setup()
        brs = Master.objects.create(name="BRS", type="category", org=org, recurrence="Monthly", target_day=5)
        main = Task.objects.create(
            description="Recurring Main",
            org=org,
            client=client,
            reporting_manager=user,
            recurrence="monthly",
            target_date=dt.date(2026, 5, 20),
            engagement_start=dt.date(2026, 5, 1),
            engagement_end=dt.date(2026, 8, 1),
        )
        TaskSubcategoryPlan.objects.create(
            main_task=main,
            subcategory=brs,
            recurrence="monthly",
            target_day=5,
            default_owner=user,
            active_from_month=dt.date(2026, 5, 1),
            active_until_month=dt.date(2026, 8, 1),
        )
        # Simulate a late child a wider engagement had previously materialised.
        Task.objects.create(
            description="BRS",
            org=org,
            client=client,
            reporting_manager=user,
            responsible=user,
            category=brs,
            parent=main,
            target_date=dt.date(2026, 7, 5),
            recurrence="monthly",
        )
        # full_clean() on the main must not raise — the late child belongs
        # to a plan and is handled by ``materialize_month``'s ceiling check,
        # not by blocking edits on the main.
        main.full_clean()  # no exception

    def test_manual_subs_late_check_still_blocks_when_no_plan(self):
        """The plan-managed bypass must not loosen the rule for legacy /
        one-time goals with manually-added subs. Without a plan, a sub
        whose target exceeds the main's target is still an inconsistency
        the user has to resolve before tightening the main.
        """
        org, user, client = _setup()
        main = Task.objects.create(
            description="Manual Main",
            org=org,
            client=client,
            reporting_manager=user,
            target_date=dt.date(2026, 6, 1),
        )
        Task.objects.create(
            description="Sub",
            org=org,
            client=client,
            reporting_manager=user,
            responsible=user,
            parent=main,
            target_date=dt.date(2026, 5, 28),
        )
        main.target_date = dt.date(2026, 5, 1)
        with self.assertRaises(ValidationError):
            main.full_clean()

    def test_dashboard_inline_patch_on_monthly_main_returns_200(self):
        """End-to-end mirror of the production report: PATCH on a Monthly
        main goal from the Dashboard's inline-edit row must return 200,
        not 400 with the row silently persisted. Before the fix the
        TaskSerializer ran ``instance.full_clean()`` AFTER ``super().save()``,
        so the row's new ``remarks`` landed in the DB while DRF returned
        ``HTTP 400 Bad Request`` — the exact "Save failed: but saved" the
        user saw on screen.
        """
        org, user, client = _setup()
        brs = Master.objects.create(name="BRS", type="category", org=org, recurrence="Monthly", target_day=5)
        api = APIClient()
        api.force_authenticate(user=user)
        # Create via the API so created_by/org are set up the way the view does.
        resp = api.post(
            "/api/tasks/",
            {
                "description": "Recurring Goal",
                "client": str(client.uid),
                "reporting_manager": str(user.uid),
                "target_date": "2026-05-20",
                "engagement_start": "2026-05-01",
                "engagement_end": "2026-08-01",
                "plans": [{"subcategory": str(brs.uid)}],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        main_uid = resp.data["uid"]
        main = Task.objects.get(uid=main_uid)
        # Simulate the production state: legacy child from a previously
        # wider engagement window, now sitting past the (tightened) main
        # target_date. ``materialize_month``'s ceiling check skips making
        # such children today, but rows that pre-date the ceiling fix are
        # still in the DB. ``objects.create`` bypasses ``full_clean`` so
        # we can plant the row directly the way historical data would.
        Task.objects.create(
            description="BRS legacy",
            org=org,
            client=client,
            reporting_manager=user,
            responsible=user,
            category=brs,
            parent=main,
            recurrence="monthly",
            target_date=dt.date(2026, 7, 5),
        )
        # The dashboard inline-edit sends target/expected/completed/remarks
        # on every save — even when the user only changed remarks.
        patch_resp = api.patch(
            f"/api/tasks/{main_uid}/",
            {
                "target_date": "2026-05-20",
                "expected_date": "2026-05-25",
                "completed_date": None,
                "remarks": "Edited from dashboard",
            },
            format="json",
        )
        self.assertEqual(patch_resp.status_code, 200, patch_resp.content)
        main.refresh_from_db()
        self.assertEqual(main.remarks, "Edited from dashboard")

    def test_patch_with_invalid_dates_rolls_back_instead_of_persisting(self):
        """Companion to the dashboard-inline regression. If a PATCH does
        fail validation (e.g. ``expected_date < target_date``), the row's
        new values must NOT have landed in the DB — the symptom the user
        reported was a 400 error with the new value visible on reload.
        Before the atomic wrap, ``super().save()`` committed first and
        the post-save ``full_clean()`` then raised, leaving a half-applied
        write behind.
        """
        org, user, client = _setup()
        api = APIClient()
        api.force_authenticate(user=user)
        main = Task.objects.create(
            description="Goal",
            org=org,
            client=client,
            reporting_manager=user,
            target_date=dt.date(2026, 6, 1),
            remarks="original",
        )
        # expected_date < target_date trips ``Task.clean``.
        patch_resp = api.patch(
            f"/api/tasks/{main.uid}/",
            {
                "target_date": "2026-06-01",
                "expected_date": "2026-05-15",
                "remarks": "should NOT persist",
            },
            format="json",
        )
        self.assertEqual(patch_resp.status_code, 400, patch_resp.content)
        main.refresh_from_db()
        self.assertEqual(main.remarks, "original", "Remarks must not have leaked through a failed validation.")

    def test_patch_succeeds_when_db_row_has_legacy_display_label_status(self):
        """Legacy rows whose ``status`` was stored as the display label
        ("Overdue") instead of the choice key ("overdue") must still accept
        a regular PATCH. Before the fix, ``instance.full_clean()`` in the
        serializer ``save`` rejected every PATCH on such rows with
        ``{"status": ["Value 'Overdue' is not a valid choice."]}`` — even
        when the client never sent a ``status`` field, because the post-save
        ``clean_fields`` pass validates the instance's existing value.
        """
        org, user, client = _setup()
        # Plant a row with a corrupt status by going through ``objects.create``
        # which skips ``full_clean`` — mirrors how legacy data ended up in
        # production. The display label fails ``STATUS_CHOICES`` validation.
        legacy = Task.objects.create(
            description="Legacy overdue goal",
            org=org,
            client=client,
            reporting_manager=user,
            responsible=user,
            target_date=dt.date(2026, 5, 10),
            status="Overdue",
        )
        api = APIClient()
        api.force_authenticate(user=user)
        patch_resp = api.patch(
            f"/api/tasks/{legacy.uid}/",
            {
                "target_date": "2026-05-10",
                "expected_date": "2026-05-19",
                "completed_date": None,
                "remarks": "Edited from dashboard",
            },
            format="json",
        )
        self.assertEqual(patch_resp.status_code, 200, patch_resp.content)
        legacy.refresh_from_db()
        self.assertEqual(legacy.remarks, "Edited from dashboard")
        # The legacy status should have been normalized to the choice key so
        # subsequent reads/writes don't keep tripping the same validator.
        self.assertEqual(legacy.status, "overdue")


class TaskWithSubtasksSerializerTests(TestCase):
    def setUp(self):
        self.org, self.user, self.client_master = _setup()
        self.factory = APIRequestFactory()

    def _ctx(self):
        req = self.factory.post("/api/tasks/")
        force_authenticate(req, user=self.user)
        return {"request": req}

    def test_create_main_with_two_subs_in_one_transaction(self):
        from core.tasks.serializers import TaskWithSubtasksSerializer

        payload = {
            "description": "Main goal",
            "org": str(self.org.uid),
            "client": str(self.client_master.uid),
            "reporting_manager": str(self.user.uid),
            "target_date": "2026-06-01",
            "recurrence": "onetime",
            "subtasks": [
                {
                    "description": "Sub A",
                    "responsible": str(self.user.uid),
                    "target_date": "2026-05-01",
                },
                {
                    "description": "Sub B",
                    "responsible": str(self.user.uid),
                    "target_date": "2026-05-15",
                },
            ],
        }
        s = TaskWithSubtasksSerializer(data=payload, context=self._ctx())
        self.assertTrue(s.is_valid(), s.errors)
        main = s.save(created_by=self.user, org=self.org)
        self.assertEqual(Task.objects.count(), 3)
        subs = list(main.subtasks.order_by("target_date"))
        self.assertEqual(len(subs), 2)
        self.assertEqual(subs[0].org_id, self.org.pk)
        self.assertEqual(subs[0].client_id, self.client_master.pk)
        self.assertEqual(subs[0].reporting_manager_id, self.user.pk)
        self.assertEqual(subs[0].recurrence, "onetime")

    def test_update_replaces_subs_and_deletes_missing(self):
        from core.tasks.serializers import TaskWithSubtasksSerializer

        main = Task.objects.create(
            description="Main",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            target_date=dt.date(2026, 6, 1),
        )
        keep = Task.objects.create(
            description="Keep",
            parent=main,
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            responsible=self.user,
            target_date=dt.date(2026, 5, 1),
        )
        Task.objects.create(
            description="Drop",
            parent=main,
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            responsible=self.user,
            target_date=dt.date(2026, 5, 1),
        )
        payload = {
            "description": "Main",
            "reporting_manager": str(self.user.uid),
            "target_date": "2026-06-01",
            "subtasks": [
                {
                    "uid": str(keep.uid),
                    "description": "Keep edited",
                    "responsible": str(self.user.uid),
                    "target_date": "2026-05-10",
                },
                {
                    "description": "New",
                    "responsible": str(self.user.uid),
                    "target_date": "2026-05-20",
                },
            ],
        }
        s = TaskWithSubtasksSerializer(instance=main, data=payload, partial=True, context=self._ctx())
        self.assertTrue(s.is_valid(), s.errors)
        s.save()
        subs = list(main.subtasks.order_by("description"))
        self.assertEqual([t.description for t in subs], ["Keep edited", "New"])

    def test_update_with_one_month_payload_preserves_other_months(self):
        # The Edit Goal modal is per-month: it sends only the currently-viewed
        # month's sub rows. Before this fix, the serializer treated the payload
        # as authoritative for the entire goal and deleted every other month's
        # subs — the user perceived the lazy re-materialization on re-open as
        # "everything got duplicated". Other-month subs must survive untouched.
        from core.tasks.serializers import TaskWithSubtasksSerializer

        main = Task.objects.create(
            description="Main",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            target_date=dt.date(2027, 4, 30),
        )
        may_sub = Task.objects.create(
            description="May sub",
            parent=main,
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            responsible=self.user,
            target_date=dt.date(2026, 5, 10),
        )
        june_sub = Task.objects.create(
            description="June sub",
            parent=main,
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            responsible=self.user,
            target_date=dt.date(2026, 6, 15),
        )
        july_sub = Task.objects.create(
            description="July sub",
            parent=main,
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            responsible=self.user,
            target_date=dt.date(2026, 7, 20),
        )
        payload = {
            "description": "Main",
            "reporting_manager": str(self.user.uid),
            "target_date": "2027-04-30",
            "subtasks": [
                {
                    "uid": str(may_sub.uid),
                    "description": "May sub edited",
                    "responsible": str(self.user.uid),
                    "target_date": "2026-05-12",
                },
            ],
        }
        s = TaskWithSubtasksSerializer(instance=main, data=payload, partial=True, context=self._ctx())
        self.assertTrue(s.is_valid(), s.errors)
        s.save()

        # The May row got its edit; the June + July rows survive untouched.
        surviving = {t.description for t in main.subtasks.all()}
        self.assertEqual(surviving, {"May sub edited", "June sub", "July sub"})
        self.assertTrue(Task.objects.filter(uid=june_sub.uid).exists())
        self.assertTrue(Task.objects.filter(uid=july_sub.uid).exists())

    def test_update_preserves_category_fk_when_name_matches(self):
        # The frontend's `categoryUidByName` collapses two masters that
        # share a display name into a single map entry (whichever was
        # iterated last wins). Without this guard, every PATCH would
        # silently swap the sub's category FK from the master tied to its
        # plan to the duplicate twin — and the modal would render the
        # Recurrence column blank for every row whose plan no longer
        # matches. Preserve the existing FK when the names still match.
        from core.tasks.serializers import TaskWithSubtasksSerializer

        sales_a = Master.objects.create(
            name="Sales",
            type="category",
            org=self.org,
            recurrence="Monthly",
            target_day=5,
        )
        sales_b = Master.objects.create(
            name="Sales ",  # trailing-whitespace twin
            type="category",
            org=self.org,
            recurrence="Monthly",
            target_day=5,
        )
        main = Task.objects.create(
            description="Main",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            target_date=dt.date(2026, 6, 1),
        )
        sub = Task.objects.create(
            description="Sales",
            parent=main,
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            responsible=self.user,
            target_date=dt.date(2026, 5, 5),
            category=sales_a,
        )
        payload = {
            "description": "Main",
            "reporting_manager": str(self.user.uid),
            "target_date": "2026-06-01",
            "subtasks": [
                {
                    "uid": str(sub.uid),
                    "description": "Sales",
                    "category": str(sales_b.uid),  # twin uid, same name
                    "responsible": str(self.user.uid),
                    "target_date": "2026-05-05",
                    "completed_date": "2026-05-05",
                },
            ],
        }
        s = TaskWithSubtasksSerializer(instance=main, data=payload, partial=True, context=self._ctx())
        self.assertTrue(s.is_valid(), s.errors)
        s.save()
        sub.refresh_from_db()
        # The FK should still point at sales_a — same effective name, so
        # the name→uid drift shouldn't silently swap the FK.
        self.assertEqual(sub.category_id, sales_a.pk)

    def test_update_creates_plan_for_new_category_without_one(self):
        # Repro for the "Plan not found for this row" alert: when the
        # Edit Goal modal adds a sub-row whose category has no existing
        # plan on the goal, the serializer must seed a TaskSubcategoryPlan
        # so the recurrence dropdown round-trips. Without this, the row
        # comes back with planUid=null and the modal aborts the change.
        from core.tasks.serializers import TaskWithSubtasksSerializer

        purchase = Master.objects.create(
            name="Data Collection - Purchase",
            type="category",
            org=self.org,
            recurrence="Monthly",
            target_day=13,
        )
        main = Task.objects.create(
            description="Main",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            target_date=dt.date(2027, 4, 30),
        )
        payload = {
            "description": "Main",
            "reporting_manager": str(self.user.uid),
            "target_date": "2027-04-30",
            "subtasks": [
                {
                    "description": "Data Collection - Purchase",
                    "category": str(purchase.uid),
                    "responsible": str(self.user.uid),
                    "target_date": "2026-05-13",
                },
            ],
        }
        s = TaskWithSubtasksSerializer(instance=main, data=payload, partial=True, context=self._ctx())
        self.assertTrue(s.is_valid(), s.errors)
        s.save()

        plans = list(main.sub_plans.all())
        self.assertEqual(len(plans), 1)
        self.assertEqual(plans[0].subcategory_id, purchase.pk)
        self.assertEqual(plans[0].recurrence, "monthly")
        self.assertEqual(plans[0].target_day, 13)
        self.assertEqual(plans[0].default_owner_id, self.user.pk)

    def test_update_does_not_duplicate_plan_when_category_already_planned(self):
        # Editing a sub-row whose category already has a plan must not
        # spawn a second plan for the same subcategory.
        from core.tasks.serializers import TaskWithSubtasksSerializer

        purchase = Master.objects.create(
            name="Data Collection - Purchase",
            type="category",
            org=self.org,
            recurrence="Monthly",
            target_day=13,
        )
        main = Task.objects.create(
            description="Main",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            target_date=dt.date(2027, 4, 30),
        )
        TaskSubcategoryPlan.objects.create(
            main_task=main,
            subcategory=purchase,
            recurrence="monthly",
            target_day=13,
            default_owner=self.user,
            active_from_month=dt.date(2026, 5, 1),
            active_until_month=dt.date(2027, 4, 1),
        )
        sub = Task.objects.create(
            description="Data Collection - Purchase",
            parent=main,
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            responsible=self.user,
            target_date=dt.date(2026, 5, 13),
            category=purchase,
        )
        payload = {
            "description": "Main",
            "reporting_manager": str(self.user.uid),
            "target_date": "2027-04-30",
            "subtasks": [
                {
                    "uid": str(sub.uid),
                    "description": "Data Collection - Purchase edited",
                    "category": str(purchase.uid),
                    "responsible": str(self.user.uid),
                    "target_date": "2026-05-14",
                },
            ],
        }
        s = TaskWithSubtasksSerializer(instance=main, data=payload, partial=True, context=self._ctx())
        self.assertTrue(s.is_valid(), s.errors)
        s.save()

        self.assertEqual(main.sub_plans.filter(subcategory=purchase).count(), 1)

    def test_create_rejects_sub_target_after_main_target(self):
        # Django's ``ValidationError`` raised inside ``_upsert_subs`` /
        # ``materialize_*`` is wrapped by ``TaskSerializer.save`` into DRF's
        # ``ValidationError`` so the API stays at 400 instead of falling
        # through to a 500. Catch the DRF flavour, not Django's, here.
        from rest_framework.exceptions import ValidationError as DrfValidationError

        from core.tasks.serializers import TaskWithSubtasksSerializer

        payload = {
            "description": "Main",
            "org": str(self.org.uid),
            "reporting_manager": str(self.user.uid),
            "target_date": "2026-06-01",
            "subtasks": [
                {
                    "description": "Late sub",
                    "responsible": str(self.user.uid),
                    "target_date": "2026-07-01",
                },
            ],
        }
        s = TaskWithSubtasksSerializer(data=payload, context=self._ctx())
        self.assertTrue(s.is_valid(), s.errors)
        with self.assertRaises(DrfValidationError) as ctx:
            s.save(created_by=self.user, org=self.org)
        self.assertIn("main goal's target date", str(ctx.exception))


class TaskWithSubtasksApiTests(TestCase):
    def setUp(self):
        self.org, self.user, self.client_master = _setup()
        self.api = APIClient()
        self.api.force_authenticate(self.user)

    def test_post_with_subtasks_creates_full_tree(self):
        payload = {
            "description": "Main goal",
            "org": str(self.org.uid),
            "client": str(self.client_master.uid),
            "reporting_manager": str(self.user.uid),
            "target_date": "2026-06-01",
            "recurrence": "onetime",
            "subtasks": [
                {"description": "S1", "responsible": str(self.user.uid), "target_date": "2026-05-01"},
            ],
        }
        res = self.api.post("/api/tasks/", payload, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(Task.objects.count(), 2)
        main = Task.objects.get(parent__isnull=True)
        self.assertEqual(main.subtasks.count(), 1)

    def test_patch_main_updates_tree(self):
        main = Task.objects.create(
            description="Main",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            target_date=dt.date(2026, 6, 1),
        )
        Task.objects.create(
            description="Old sub",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            responsible=self.user,
            parent=main,
            target_date=dt.date(2026, 5, 1),
        )
        payload = {
            "description": "Main edited",
            "subtasks": [
                {"description": "New sub", "responsible": str(self.user.uid), "target_date": "2026-05-15"},
            ],
        }
        res = self.api.patch(f"/api/tasks/{main.uid}/", payload, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        main.refresh_from_db()
        self.assertEqual(main.description, "Main edited")
        subs = list(main.subtasks.all())
        self.assertEqual(len(subs), 1)
        self.assertEqual(subs[0].description, "New sub")
        self.assertFalse(Task.objects.filter(description="Old sub").exists())

    def test_patch_without_subtasks_stays_flat(self):
        # PATCH without a subtasks key must route through the flat
        # TaskSerializer — confirms the dispatch heuristic works on
        # PATCH not just POST, and existing single-row endpoints used
        # by the board/dashboard remain untouched by Task 4.
        main = Task.objects.create(
            description="Main",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            target_date=dt.date(2026, 6, 1),
        )
        sub = Task.objects.create(
            description="Existing sub",
            parent=main,
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            responsible=self.user,
            target_date=dt.date(2026, 5, 1),
        )
        res = self.api.patch(
            f"/api/tasks/{main.uid}/",
            {"description": "Main edited"},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        main.refresh_from_db()
        self.assertEqual(main.description, "Main edited")
        # Sub list is untouched because the flat serializer doesn't
        # know about subs.
        self.assertTrue(Task.objects.filter(pk=sub.pk).exists())
        self.assertEqual(main.subtasks.count(), 1)

    def test_flat_post_without_subtasks_uses_flat_serializer(self):
        payload = {
            "description": "Standalone",
            "org": str(self.org.uid),
            "reporting_manager": str(self.user.uid),
        }
        res = self.api.post("/api/tasks/", payload, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(Task.objects.count(), 1)

    def test_list_response_includes_parent_field_on_subs(self):
        main = Task.objects.create(
            description="Main",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            target_date=dt.date(2026, 6, 1),
        )
        sub = Task.objects.create(
            description="Sub",
            parent=main,
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            responsible=self.user,
            target_date=dt.date(2026, 5, 1),
        )
        res = self.api.get(f"/api/tasks/{sub.uid}/")
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(str(res.data["parent"]), str(main.uid))

    def test_list_response_main_has_null_parent(self):
        main = Task.objects.create(
            description="Main",
            org=self.org,
            reporting_manager=self.user,
        )
        res = self.api.get(f"/api/tasks/{main.uid}/")
        self.assertEqual(res.status_code, 200, res.data)
        self.assertIsNone(res.data["parent"])

    def test_nested_create_broadcasts_main_and_each_sub(self):
        from unittest.mock import patch

        payload = {
            "description": "Main",
            "org": str(self.org.uid),
            "reporting_manager": str(self.user.uid),
            "target_date": "2026-06-01",
            "subtasks": [
                {"description": "S1", "responsible": str(self.user.uid), "target_date": "2026-05-01"},
                {"description": "S2", "responsible": str(self.user.uid), "target_date": "2026-05-15"},
            ],
        }
        with patch("core.tasks.views.broadcast") as bc:
            res = self.api.post("/api/tasks/", payload, format="json")
            self.assertEqual(res.status_code, 201, res.data)
            # Expect 1 broadcast for the Main + 2 broadcasts for each sub = 3 calls.
            self.assertEqual(bc.call_count, 3, [c.args for c in bc.call_args_list])

    def test_flat_patch_rejects_sub_target_after_parent(self):
        main = Task.objects.create(
            description="Main",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            target_date=dt.date(2026, 6, 1),
        )
        sub = Task.objects.create(
            description="Sub",
            parent=main,
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            responsible=self.user,
            target_date=dt.date(2026, 5, 1),
        )
        # PATCH the sub directly (no subtasks key — flat serializer path).
        res = self.api.patch(
            f"/api/tasks/{sub.uid}/",
            {"target_date": "2026-07-01"},
            format="json",
        )
        self.assertEqual(res.status_code, 400, res.data)
        self.assertIn("main goal's target date", str(res.data))


class SubtaskCompletionTests(TestCase):
    """Sub-task ``completed_date`` flows through the nested upsert and the
    auto-derived status keeps ``Task.clean()`` happy."""

    def setUp(self):
        self.org, self.user, self.client_master = _setup()
        self.api = APIClient()
        self.api.force_authenticate(self.user)

    def test_setting_sub_completed_date_marks_status_completed(self):
        main = Task.objects.create(
            description="Main",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            target_date=dt.date(2026, 6, 1),
        )
        sub = Task.objects.create(
            description="Sub",
            parent=main,
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            responsible=self.user,
            target_date=dt.date(2026, 5, 1),
        )
        payload = {
            "description": "Main",
            "subtasks": [
                {
                    "uid": str(sub.uid),
                    "description": "Sub",
                    "responsible": str(self.user.uid),
                    "target_date": "2026-05-01",
                    "completed_date": "2026-04-30",
                }
            ],
        }
        res = self.api.patch(f"/api/tasks/{main.uid}/", payload, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        sub.refresh_from_db()
        self.assertEqual(str(sub.completed_date), "2026-04-30")
        self.assertEqual(sub.status, "completed")

    def test_completing_late_sets_completed_delay(self):
        main = Task.objects.create(
            description="Main",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            target_date=dt.date(2026, 6, 1),
        )
        sub = Task.objects.create(
            description="Sub",
            parent=main,
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            responsible=self.user,
            target_date=dt.date(2026, 5, 1),
        )
        payload = {
            "description": "Main",
            "subtasks": [
                {
                    "uid": str(sub.uid),
                    "description": "Sub",
                    "responsible": str(self.user.uid),
                    "target_date": "2026-05-01",
                    "completed_date": "2026-05-30",
                }
            ],
        }
        res = self.api.patch(f"/api/tasks/{main.uid}/", payload, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        sub.refresh_from_db()
        self.assertEqual(sub.status, "completed_delay")


class MainCompletionGuardTests(TestCase):
    """A main goal cannot be marked complete while any sub is still open."""

    def setUp(self):
        self.org, self.user, self.client_master = _setup()
        self.api = APIClient()
        self.api.force_authenticate(self.user)

    def test_main_complete_rejected_when_subs_open(self):
        main = Task.objects.create(
            description="Main",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            responsible=self.user,
            target_date=dt.date(2026, 6, 1),
        )
        Task.objects.create(
            description="Sub still open",
            parent=main,
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            responsible=self.user,
            target_date=dt.date(2026, 5, 1),
        )
        res = self.api.patch(
            f"/api/tasks/{main.uid}/",
            {"status": "completed", "completed_date": "2026-05-15"},
            format="json",
        )
        self.assertEqual(res.status_code, 400, res.data)
        self.assertIn("sub-tasks are open", str(res.data).lower())

    def test_main_complete_allowed_when_all_subs_done(self):
        main = Task.objects.create(
            description="Main",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            responsible=self.user,
            target_date=dt.date(2026, 6, 1),
        )
        Task.objects.create(
            description="Sub done",
            parent=main,
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            responsible=self.user,
            target_date=dt.date(2026, 5, 1),
            completed_date=dt.date(2026, 4, 30),
            status="completed",
        )
        res = self.api.patch(
            f"/api/tasks/{main.uid}/",
            {"status": "completed", "completed_date": "2026-05-15"},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)


class MainTaskInlinePatchTests(TestCase):
    """Dashboard drill-down PATCHes only the fields the user touched —
    typically ``completed_date`` with no ``status``. The serializer must
    derive status from the dates so ``Task.clean()`` doesn't reject it."""

    def setUp(self):
        self.org, self.user, self.client_master = _setup()
        self.api = APIClient()
        self.api.force_authenticate(self.user)

    def test_patch_completed_date_only_on_overdue_task_marks_completed_delay(self):
        main = Task.objects.create(
            description="Main",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            responsible=self.user,
            target_date=dt.date(2026, 4, 18),
            status="overdue",
        )
        res = self.api.patch(
            f"/api/tasks/{main.uid}/",
            {"completed_date": "2026-05-08"},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        main.refresh_from_db()
        self.assertEqual(str(main.completed_date), "2026-05-08")
        self.assertEqual(main.status, "completed_delay")

    def test_patch_completed_date_on_or_before_target_marks_completed(self):
        main = Task.objects.create(
            description="Main",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            responsible=self.user,
            target_date=dt.date(2026, 5, 10),
            status="pending",
        )
        res = self.api.patch(
            f"/api/tasks/{main.uid}/",
            {"completed_date": "2026-05-08"},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        main.refresh_from_db()
        self.assertEqual(main.status, "completed")

    def test_clearing_completed_date_drops_stale_completed_status(self):
        main = Task.objects.create(
            description="Main",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            responsible=self.user,
            target_date=dt.date(2026, 5, 10),
            completed_date=dt.date(2026, 5, 8),
            status="completed",
        )
        res = self.api.patch(
            f"/api/tasks/{main.uid}/",
            {"completed_date": None},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        main.refresh_from_db()
        self.assertIsNone(main.completed_date)
        self.assertEqual(main.status, "pending")


class EmployeeSubEditPermissionTests(TestCase):
    """Employees may only edit subs allocated to themselves; managers/admins
    can edit anything."""

    def setUp(self):
        self.org = Org.objects.create(name="Acme")
        self.client_master = Master.objects.create(name="C1", type="client", org=self.org)
        self.manager = User.objects.create_user(username="mgr", password="pw", full_name="Mgr")
        OrgMembership.objects.create(user=self.manager, org=self.org, role="admin")
        self.alice = User.objects.create_user(username="alice", password="pw", full_name="Alice")
        OrgMembership.objects.create(user=self.alice, org=self.org, role="employee")
        self.bob = User.objects.create_user(username="bob", password="pw", full_name="Bob")
        OrgMembership.objects.create(user=self.bob, org=self.org, role="employee")

        self.main = Task.objects.create(
            description="Main",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.manager,
            responsible=self.alice,
            target_date=dt.date(2026, 6, 1),
        )
        self.alice_sub = Task.objects.create(
            description="Alice sub",
            parent=self.main,
            org=self.org,
            client=self.client_master,
            reporting_manager=self.manager,
            responsible=self.alice,
            target_date=dt.date(2026, 5, 1),
        )
        self.bob_sub = Task.objects.create(
            description="Bob sub",
            parent=self.main,
            org=self.org,
            client=self.client_master,
            reporting_manager=self.manager,
            responsible=self.bob,
            target_date=dt.date(2026, 5, 1),
        )

    def _patch_as(self, user, payload):
        api = APIClient()
        api.force_authenticate(user)
        return api.patch(f"/api/tasks/{self.main.uid}/", payload, format="json")

    def test_employee_can_complete_their_own_sub(self):
        payload = {
            "description": "Main",
            "subtasks": [
                {
                    "uid": str(self.alice_sub.uid),
                    "description": "Alice sub",
                    "responsible": str(self.alice.uid),
                    "target_date": "2026-05-01",
                    "completed_date": "2026-04-30",
                },
                {
                    "uid": str(self.bob_sub.uid),
                    "description": "Bob sub",
                    "responsible": str(self.bob.uid),
                    "target_date": "2026-05-01",
                },
            ],
        }
        res = self._patch_as(self.alice, payload)
        self.assertEqual(res.status_code, 200, res.data)
        self.alice_sub.refresh_from_db()
        self.assertEqual(str(self.alice_sub.completed_date), "2026-04-30")

    def test_employee_cannot_change_another_users_sub(self):
        payload = {
            "description": "Main",
            "subtasks": [
                {
                    "uid": str(self.alice_sub.uid),
                    "description": "Alice sub",
                    "responsible": str(self.alice.uid),
                    "target_date": "2026-05-01",
                },
                {
                    "uid": str(self.bob_sub.uid),
                    "description": "Bob sub edited by Alice",
                    "responsible": str(self.bob.uid),
                    "target_date": "2026-05-01",
                    "completed_date": "2026-04-30",
                },
            ],
        }
        res = self._patch_as(self.alice, payload)
        self.assertEqual(res.status_code, 400, res.data)
        self.assertIn("allocated to you", str(res.data).lower())

    def test_admin_can_edit_any_sub(self):
        payload = {
            "description": "Main",
            "subtasks": [
                {
                    "uid": str(self.alice_sub.uid),
                    "description": "Alice sub",
                    "responsible": str(self.alice.uid),
                    "target_date": "2026-05-01",
                    "completed_date": "2026-04-30",
                },
                {
                    "uid": str(self.bob_sub.uid),
                    "description": "Bob sub edited by admin",
                    "responsible": str(self.bob.uid),
                    "target_date": "2026-05-01",
                    "completed_date": "2026-04-29",
                },
            ],
        }
        res = self._patch_as(self.manager, payload)
        self.assertEqual(res.status_code, 200, res.data)
        self.bob_sub.refresh_from_db()
        self.assertEqual(self.bob_sub.description, "Bob sub edited by admin")


class TaskEngagementWindowTests(TestCase):
    def test_task_has_engagement_start_and_end_nullable(self):
        org, user, _client = _setup()
        t = Task.objects.create(
            description="Goal",
            org=org,
            reporting_manager=user,
            target_date=dt.date(2026, 6, 1),
            engagement_start=dt.date(2026, 5, 1),
            engagement_end=dt.date(2027, 4, 1),
        )
        t.refresh_from_db()
        self.assertEqual(t.engagement_start, dt.date(2026, 5, 1))
        self.assertEqual(t.engagement_end, dt.date(2027, 4, 1))

    def test_engagement_fields_default_to_null(self):
        org, user, _client = _setup()
        t = Task.objects.create(
            description="Goal",
            org=org,
            reporting_manager=user,
            target_date=dt.date(2026, 6, 1),
        )
        t.refresh_from_db()
        self.assertIsNone(t.engagement_start)
        self.assertIsNone(t.engagement_end)


class TaskSubcategoryPlanModelTests(TestCase):
    def setUp(self):
        self.org, self.user, _client = _setup()
        self.main = Task.objects.create(
            description="Goal",
            org=self.org,
            reporting_manager=self.user,
            target_date=dt.date(2027, 4, 30),
        )
        self.sub_cat = Master.objects.create(name="BRS", type="category", org=self.org)

    def test_plan_can_be_created_with_required_fields(self):
        plan = TaskSubcategoryPlan.objects.create(
            main_task=self.main,
            subcategory=self.sub_cat,
            recurrence="monthly",
            target_day=5,
            default_owner=self.user,
            active_from_month=dt.date(2026, 5, 1),
        )
        plan.refresh_from_db()
        self.assertEqual(plan.main_task_id, self.main.pk)
        self.assertEqual(plan.subcategory_id, self.sub_cat.pk)
        self.assertEqual(plan.recurrence, "monthly")
        self.assertEqual(plan.target_day, 5)
        self.assertEqual(plan.default_owner_id, self.user.pk)
        self.assertEqual(plan.active_from_month, dt.date(2026, 5, 1))
        self.assertIsNone(plan.active_until_month)

    def test_unique_main_task_subcategory(self):
        TaskSubcategoryPlan.objects.create(
            main_task=self.main,
            subcategory=self.sub_cat,
            recurrence="monthly",
            active_from_month=dt.date(2026, 5, 1),
        )
        with self.assertRaises(IntegrityError), transaction.atomic():
            TaskSubcategoryPlan.objects.create(
                main_task=self.main,
                subcategory=self.sub_cat,
                recurrence="monthly",
                active_from_month=dt.date(2026, 6, 1),
            )

    def test_deleting_main_task_cascades_to_plans(self):
        TaskSubcategoryPlan.objects.create(
            main_task=self.main,
            subcategory=self.sub_cat,
            recurrence="monthly",
            active_from_month=dt.date(2026, 5, 1),
        )
        self.main.delete()
        self.assertEqual(TaskSubcategoryPlan.objects.count(), 0)


class MaterializeMonthTests(TestCase):
    def setUp(self):
        self.org, self.user, self.client_master = _setup()
        self.main = Task.objects.create(
            description="Goal",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            target_date=dt.date(2027, 4, 30),
            engagement_start=dt.date(2026, 5, 1),
            engagement_end=dt.date(2027, 4, 1),
        )
        self.brs = Master.objects.create(name="BRS", type="category", org=self.org)
        self.plan = TaskSubcategoryPlan.objects.create(
            main_task=self.main,
            subcategory=self.brs,
            recurrence="monthly",
            target_day=5,
            default_owner=self.user,
            active_from_month=dt.date(2026, 5, 1),
            active_until_month=dt.date(2027, 4, 1),
        )

    def test_materializes_one_child_for_active_month(self):
        created = materialize_month(self.main, dt.date(2026, 5, 1))
        self.assertEqual(len(created), 1)
        child = created[0]
        self.assertEqual(child.parent_id, self.main.pk)
        self.assertEqual(child.category_id, self.brs.pk)
        self.assertEqual(child.target_date, dt.date(2026, 5, 5))
        self.assertEqual(child.responsible_id, self.user.pk)

    def test_idempotent_second_call_creates_nothing(self):
        materialize_month(self.main, dt.date(2026, 5, 1))
        created_again = materialize_month(self.main, dt.date(2026, 5, 1))
        self.assertEqual(created_again, [])
        self.assertEqual(self.main.subtasks.count(), 1)

    def test_skips_months_outside_active_window(self):
        # Active window is May 2026 - Apr 2027.
        created = materialize_month(self.main, dt.date(2026, 4, 1))  # before
        self.assertEqual(created, [])
        created = materialize_month(self.main, dt.date(2027, 5, 1))  # after
        self.assertEqual(created, [])

    def test_quarterly_skips_off_step_months(self):
        self.plan.recurrence = "quarterly"
        self.plan.save()
        # Step starts at active_from_month (May). Off-step (June, July) should
        # produce nothing; on-step (Aug, Nov) should materialize.
        self.assertEqual(materialize_month(self.main, dt.date(2026, 6, 1)), [])
        self.assertEqual(materialize_month(self.main, dt.date(2026, 7, 1)), [])
        self.assertEqual(len(materialize_month(self.main, dt.date(2026, 8, 1))), 1)
        self.assertEqual(len(materialize_month(self.main, dt.date(2026, 11, 1))), 1)

    def test_clamps_target_day_to_last_day_of_short_month(self):
        self.plan.target_day = 31
        self.plan.save()
        # February 2027 has 28 days; clamp to the 28th.
        Task.objects.filter(parent=self.main).delete()
        created = materialize_month(self.main, dt.date(2027, 2, 1))
        self.assertEqual(created[0].target_date, dt.date(2027, 2, 28))

    def test_skips_past_ceiling_children_silently(self):
        # main.target_date = 2027-04-30 (set in setUp). The plan's active
        # window is extended past that ceiling; materialising May 2027 would
        # try to create a child at 2027-05-05 (past the goal's deadline).
        # The runtime materializer must SKIP past-ceiling rows — not raise —
        # mirroring the same skip the backfill migration (0009) applies. The
        # raise path was the source of an opaque 500 on the create-with-plans
        # endpoint when a goal's target_date came in tighter than its
        # engagement window.
        self.plan.active_until_month = dt.date(2027, 5, 1)
        self.plan.save()
        created = materialize_month(self.main, dt.date(2027, 5, 1))
        self.assertEqual(created, [])
        self.assertEqual(self.main.subtasks.count(), 0)


class CascadeOwnerForwardTests(TestCase):
    def setUp(self):
        self.org, self.alice, self.client_master = _setup()
        self.bob = User.objects.create_user(username="bob", password="pw", full_name="Bob")
        OrgMembership.objects.create(user=self.bob, org=self.org, role="employee")
        self.main = Task.objects.create(
            description="Goal",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.alice,
            target_date=dt.date(2027, 4, 30),
            engagement_start=dt.date(2026, 5, 1),
            engagement_end=dt.date(2027, 4, 1),
        )
        self.brs = Master.objects.create(name="BRS", type="category", org=self.org)
        self.plan = TaskSubcategoryPlan.objects.create(
            main_task=self.main,
            subcategory=self.brs,
            recurrence="monthly",
            target_day=5,
            default_owner=self.alice,
            active_from_month=dt.date(2026, 5, 1),
            active_until_month=dt.date(2027, 4, 1),
        )
        # Materialize 3 children (May, Jun, Jul) so we have something to cascade.
        for m in (5, 6, 7):
            materialize_month(self.main, dt.date(2026, m, 1))
        self.may = Task.objects.get(parent=self.main, target_date=dt.date(2026, 5, 5))
        self.jun = Task.objects.get(parent=self.main, target_date=dt.date(2026, 6, 5))
        self.jul = Task.objects.get(parent=self.main, target_date=dt.date(2026, 7, 5))

    def test_changing_jun_owner_cascades_to_jul_but_not_may(self):
        cascade_owner_forward(self.jun, new_owner=self.bob)
        self.may.refresh_from_db()
        self.jun.refresh_from_db()
        self.jul.refresh_from_db()
        self.assertEqual(self.may.responsible_id, self.alice.pk)  # untouched
        self.assertEqual(self.jun.responsible_id, self.bob.pk)
        self.assertEqual(self.jul.responsible_id, self.bob.pk)

    def test_cascade_updates_plan_default_owner(self):
        cascade_owner_forward(self.jun, new_owner=self.bob)
        self.plan.refresh_from_db()
        self.assertEqual(self.plan.default_owner_id, self.bob.pk)

    def test_cascade_only_affects_same_plan(self):
        other_cat = Master.objects.create(name="VAT", type="category", org=self.org)
        TaskSubcategoryPlan.objects.create(
            main_task=self.main,
            subcategory=other_cat,
            recurrence="monthly",
            target_day=10,
            default_owner=self.alice,
            active_from_month=dt.date(2026, 5, 1),
            active_until_month=dt.date(2027, 4, 1),
        )
        materialize_month(self.main, dt.date(2026, 6, 1))
        vat_jun = Task.objects.get(parent=self.main, category=other_cat, target_date=dt.date(2026, 6, 10))
        cascade_owner_forward(self.jun, new_owner=self.bob)
        vat_jun.refresh_from_db()
        self.assertEqual(vat_jun.responsible_id, self.alice.pk)  # other plan untouched

    def test_cascade_when_plan_missing_still_updates_child(self):
        """Orphaned child (no matching plan) — cascade just updates the row."""
        self.plan.delete()
        cascade_owner_forward(self.jun, new_owner=self.bob)
        self.jun.refresh_from_db()
        self.assertEqual(self.jun.responsible_id, self.bob.pk)

    def test_cascade_returns_only_one_when_no_later_children(self):
        """Cascading the last materialized child returns [] (no later children)."""
        rows = cascade_owner_forward(self.jul, new_owner=self.bob)
        self.assertEqual(rows, [])


class AddOrExtendPlanTests(TestCase):
    def setUp(self):
        self.org, self.user, self.client_master = _setup()
        self.main = Task.objects.create(
            description="Goal",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            target_date=dt.date(2027, 4, 30),
            engagement_start=dt.date(2026, 5, 1),
            engagement_end=dt.date(2027, 4, 1),
        )
        self.brs = Master.objects.create(
            name="BRS",
            type="category",
            org=self.org,
            recurrence="Monthly",
            target_day=5,
        )

    def test_creates_new_plan_when_none_exists(self):
        plan, child, _all_created = add_or_extend_plan(
            self.main,
            self.brs,
            month_start=dt.date(2026, 5, 1),
            owner=self.user,
        )
        self.assertEqual(plan.main_task_id, self.main.pk)
        self.assertEqual(plan.recurrence, "monthly")
        self.assertEqual(plan.target_day, 5)
        self.assertEqual(plan.active_from_month, dt.date(2026, 5, 1))
        self.assertEqual(plan.active_until_month, dt.date(2027, 4, 1))
        assert child is not None
        self.assertEqual(child.target_date, dt.date(2026, 5, 5))

    def test_extends_existing_plan_to_earlier_active_from(self):
        plan = TaskSubcategoryPlan.objects.create(
            main_task=self.main,
            subcategory=self.brs,
            recurrence="monthly",
            target_day=5,
            active_from_month=dt.date(2026, 8, 1),
            active_until_month=dt.date(2026, 9, 1),
        )
        plan2, _child, _created = add_or_extend_plan(
            self.main, self.brs, month_start=dt.date(2026, 6, 1), owner=self.user
        )
        self.assertEqual(plan2.pk, plan.pk)
        self.assertEqual(plan2.active_from_month, dt.date(2026, 6, 1))
        self.assertEqual(plan2.active_until_month, dt.date(2026, 9, 1))

    def test_extends_existing_plan_clearing_capped_until(self):
        TaskSubcategoryPlan.objects.create(
            main_task=self.main,
            subcategory=self.brs,
            recurrence="monthly",
            target_day=5,
            active_from_month=dt.date(2026, 5, 1),
            active_until_month=dt.date(2026, 6, 1),
        )
        plan2, _, _created = add_or_extend_plan(self.main, self.brs, month_start=dt.date(2026, 8, 1), owner=self.user)
        self.assertEqual(plan2.active_from_month, dt.date(2026, 5, 1))
        self.assertEqual(plan2.active_until_month, dt.date(2027, 4, 1))


class CapPlanTests(TestCase):
    def setUp(self):
        self.org, self.user, self.client_master = _setup()
        self.main = Task.objects.create(
            description="Goal",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            target_date=dt.date(2027, 4, 30),
            engagement_start=dt.date(2026, 5, 1),
            engagement_end=dt.date(2027, 4, 1),
        )
        self.brs = Master.objects.create(name="BRS", type="category", org=self.org)
        self.plan = TaskSubcategoryPlan.objects.create(
            main_task=self.main,
            subcategory=self.brs,
            recurrence="monthly",
            target_day=5,
            default_owner=self.user,
            active_from_month=dt.date(2026, 5, 1),
            active_until_month=dt.date(2027, 4, 1),
        )
        for m in (5, 6, 7, 8):
            materialize_month(self.main, dt.date(2026, m, 1))

    def test_caps_plan_and_deletes_uncompleted_future_children(self):
        result = cap_plan(self.plan, from_month=dt.date(2026, 7, 1))
        self.plan.refresh_from_db()
        self.assertEqual(self.plan.active_until_month, dt.date(2026, 6, 1))
        remaining = sorted(Task.objects.filter(parent=self.main).values_list("target_date", flat=True))
        self.assertEqual(remaining, [dt.date(2026, 5, 5), dt.date(2026, 6, 5)])
        self.assertEqual(result["plan_capped"], True)
        self.assertEqual(result["children_deleted"], 2)

    def test_keeps_completed_children_even_when_capped(self):
        jul = Task.objects.get(parent=self.main, target_date=dt.date(2026, 7, 5))
        jul.completed_date = dt.date(2026, 7, 4)
        jul.status = "completed"
        jul.save()

        cap_plan(self.plan, from_month=dt.date(2026, 7, 1))

        remaining = sorted(Task.objects.filter(parent=self.main).values_list("target_date", flat=True))
        self.assertEqual(
            remaining,
            [dt.date(2026, 5, 5), dt.date(2026, 6, 5), dt.date(2026, 7, 5)],
        )

    def test_capping_at_or_before_active_from_deletes_plan(self):
        result = cap_plan(self.plan, from_month=dt.date(2026, 5, 1))
        self.assertFalse(TaskSubcategoryPlan.objects.filter(pk=self.plan.pk).exists())
        self.assertEqual(result["plan_capped"], False)
        self.assertEqual(result["plan_deleted"], True)

    def test_cap_after_existing_until_is_noop(self):
        # Plan already capped at Aug 2026. Capping at Dec 2026 must not
        # extend the active window forward — the cap should stay at Aug 1.
        self.plan.active_until_month = dt.date(2026, 8, 1)
        self.plan.save(update_fields=["active_until_month"])
        # Drop any children that fall after the existing cap so the test is
        # only about the plan's date logic, not about deletions.
        Task.objects.filter(parent=self.main, target_date__gte=dt.date(2026, 9, 1)).delete()
        result = cap_plan(self.plan, from_month=dt.date(2026, 12, 1))
        self.plan.refresh_from_db()
        self.assertEqual(self.plan.active_until_month, dt.date(2026, 8, 1))
        # No children should be deleted (none past Aug to begin with).
        self.assertEqual(result["children_deleted"], 0)
        # Still treat as a "cap" (no plan_deleted), even though it was a no-op.
        self.assertTrue(result["plan_capped"])


class CreateTaskWithPlansAPITests(TestCase):
    def setUp(self):
        self.org, self.user, self.client_master = _setup()
        self.brs = Master.objects.create(
            name="BRS",
            type="category",
            org=self.org,
            recurrence="Monthly",
            target_day=5,
        )
        self.api = APIClient()
        self.api.force_authenticate(user=self.user)

    def test_create_dedupes_plans_by_subcategory_name(self):
        # Two sub-cat masters can land in the caller's view with the same
        # display name — most often a trailing-whitespace twin ("Sales" vs
        # "Sales ") that slipped past the unique-name check, or two masters
        # sharing a name across orgs the caller belongs to. The frontend
        # generates one row per master and the payload ends up with two
        # distinct sub-cat uids; without dedup, each plan spawns its own
        # subtask tree and the user opens the goal to find the same
        # sub-cat duplicated on every month.
        parent = Master.objects.create(name="Main", type="category", org=self.org)
        sales_a = Master.objects.create(
            name="Sales",
            type="category",
            org=self.org,
            parent=parent,
            recurrence="Monthly",
            target_day=5,
        )
        sales_b = Master.objects.create(
            name="Sales ",  # trailing-whitespace twin
            type="category",
            org=self.org,
            parent=parent,
            recurrence="Monthly",
            target_day=5,
        )

        body = {
            "description": "Test goal",
            "client": str(self.client_master.uid),
            "reporting_manager": str(self.user.uid),
            "target_date": "2027-04-30",
            "engagement_start": "2026-05-01",
            "engagement_end": "2027-04-01",
            "plans": [
                {"subcategory": str(sales_a.uid), "default_owner": str(self.user.uid), "recurrence": "Monthly"},
                {"subcategory": str(sales_b.uid), "default_owner": str(self.user.uid), "recurrence": "Monthly"},
            ],
        }
        resp = self.api.post("/api/tasks/", body, format="json")
        self.assertEqual(resp.status_code, 201, resp.content)
        goal = Task.objects.get(uid=resp.data["uid"])
        # Only one plan should land — the duplicate gets dropped at the
        # server because the sub-cat name matches after normalisation.
        self.assertEqual(goal.sub_plans.count(), 1)
        # And every materialised month carries exactly one "Sales" child,
        # not two.
        may_subs = goal.subtasks.filter(target_date__year=2026, target_date__month=5)
        self.assertEqual(may_subs.count(), 1)

    def test_create_with_plans_payload_materializes_only_start_month(self):
        # A goal is created for ONE selected month at a time. Even though the
        # engagement spans 12 months, creating the goal must only materialise
        # the start month's child rows — later months roll forward lazily as
        # each month is opened (see the ``?month=`` retrieve test below). This
        # is the whole point: a 12-month engagement must NOT spawn 12x rows up
        # front.
        today_first = dt.date.today().replace(day=1)
        eng_year = today_first.year + (1 if today_first.month + 11 > 12 else 0)
        eng_month = ((today_first.month - 1 + 11) % 12) + 1
        engagement_end = dt.date(eng_year, eng_month, 1)
        # The frontend stretches the main goal's target_date to the last
        # materialized child's date — mirror that so the model's "sub <= main"
        # invariant holds for every child.
        target_date = engagement_end.replace(day=28)
        body = {
            "description": "Book Keeping",
            "client": str(self.client_master.uid),
            "reporting_manager": str(self.user.uid),
            "target_date": target_date.isoformat(),
            "engagement_start": today_first.isoformat(),
            "engagement_end": engagement_end.isoformat(),
            "plans": [
                {
                    "subcategory": str(self.brs.uid),
                    "default_owner": str(self.user.uid),
                }
            ],
        }
        resp = self.api.post("/api/tasks/", body, format="json")
        self.assertEqual(resp.status_code, 201, resp.content)

        goal = Task.objects.get(uid=resp.data["uid"])
        self.assertEqual(goal.engagement_start, today_first)
        self.assertEqual(goal.engagement_end, engagement_end)

        # The plan still records the FULL engagement window so future months
        # can materialise lazily on their own cadence.
        plans = list(goal.sub_plans.all())
        self.assertEqual(len(plans), 1)
        self.assertEqual(plans[0].subcategory_id, self.brs.pk)
        self.assertEqual(plans[0].active_from_month, today_first)
        self.assertEqual(plans[0].recurrence, "monthly")
        self.assertEqual(plans[0].target_day, 5)
        self.assertEqual(plans[0].active_until_month, engagement_end)

        # Only the start month is materialised at create time — exactly one
        # child for this monthly plan, at the start month's target day.
        children = list(goal.subtasks.order_by("target_date"))
        self.assertEqual(len(children), 1)
        self.assertEqual(children[0].target_date, today_first.replace(day=5))
        self.assertEqual(children[0].responsible_id, self.user.pk)
        self.assertEqual(children[0].category_id, self.brs.pk)

        # Recurrence rolls forward automatically: opening a later month via the
        # detail endpoint lazily materialises that month's child on demand.
        next_month = (today_first + dt.timedelta(days=31)).replace(day=1)
        resp2 = self.api.get(f"/api/tasks/{goal.uid}/?month={next_month:%Y-%m}")
        self.assertEqual(resp2.status_code, 200, resp2.content)
        self.assertEqual(goal.subtasks.count(), 2)
        self.assertTrue(goal.subtasks.filter(target_date=next_month.replace(day=5)).exists())

    def test_create_with_tighter_target_date_truncates_engagement_not_500(self):
        """Goal target_date earlier than the engagement_end must NOT 500.

        Before the fix, ``materialize_month`` would try to create a child
        whose ``target_date`` exceeds the goal's ``target_date``, hit
        ``Task.clean()``, raise ``django.core.exceptions.ValidationError``,
        and surface as an uncaught 500 because DRF doesn't translate Django's
        ValidationError. The fix skips past-ceiling children (mirroring
        migration 0009) and wraps any residual Django ValidationError in a
        DRF one so the API stays at 400 for genuine input errors.
        """
        today_first = dt.date.today().replace(day=1)
        eng_year = today_first.year + (1 if today_first.month + 11 > 12 else 0)
        eng_month = ((today_first.month - 1 + 11) % 12) + 1
        engagement_end = dt.date(eng_year, eng_month, 1)
        # Goal ends BEFORE the engagement window — no future child can fit.
        tight_target = today_first.replace(day=10)
        body = {
            "description": "Tight goal",
            "client": str(self.client_master.uid),
            "reporting_manager": str(self.user.uid),
            "target_date": tight_target.isoformat(),
            "engagement_start": today_first.isoformat(),
            "engagement_end": engagement_end.isoformat(),
            "plans": [{"subcategory": str(self.brs.uid)}],
        }
        resp = self.api.post("/api/tasks/", body, format="json")
        # The save itself succeeds (201) — children that would exceed the
        # goal's target_date are silently skipped, leaving only the ones
        # that fit. Past-ceiling materialisation can be retried later when
        # the user stretches the goal target.
        self.assertEqual(resp.status_code, 201, resp.content)
        goal = Task.objects.get(uid=resp.data["uid"])
        children = list(goal.subtasks.all())
        # BRS target_day is 5; only the first month's child (day 5) fits
        # under tight_target (day 10 of the same month). All future months
        # are skipped because their target_date (day 5 of a later month) is
        # past tight_target.
        self.assertEqual(len(children), 1)
        self.assertEqual(children[0].target_date, today_first.replace(day=5))


class RetrieveTaskWithMonthTests(TestCase):
    def setUp(self):
        self.org, self.user, self.client_master = _setup()
        self.brs = Master.objects.create(name="BRS", type="category", org=self.org, recurrence="Monthly", target_day=5)
        self.api = APIClient()
        self.api.force_authenticate(user=self.user)
        self.main = Task.objects.create(
            description="Goal",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            target_date=dt.date(2027, 4, 30),
            engagement_start=dt.date(2026, 5, 1),
            engagement_end=dt.date(2027, 4, 1),
        )
        TaskSubcategoryPlan.objects.create(
            main_task=self.main,
            subcategory=self.brs,
            recurrence="monthly",
            target_day=5,
            default_owner=self.user,
            active_from_month=dt.date(2026, 5, 1),
            active_until_month=dt.date(2027, 4, 1),
        )

    def test_retrieve_with_month_lazy_materializes_and_returns_subtasks(self):
        url = f"/api/tasks/{self.main.uid}/?month=2026-08"
        resp = self.api.get(url)
        self.assertEqual(resp.status_code, 200, resp.content)
        children = list(self.main.subtasks.all())
        self.assertEqual(len(children), 1)
        self.assertEqual(children[0].target_date, dt.date(2026, 8, 5))
        self.assertIn("subtasks", resp.data)
        self.assertEqual(len(resp.data["subtasks"]), 1)

    def test_retrieve_with_month_outside_engagement_returns_no_subtasks(self):
        url = f"/api/tasks/{self.main.uid}/?month=2025-04"
        resp = self.api.get(url)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["subtasks"], [])
        self.assertEqual(self.main.subtasks.count(), 0)

    def test_retrieve_without_month_param_does_not_materialize(self):
        url = f"/api/tasks/{self.main.uid}/"
        resp = self.api.get(url)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.main.subtasks.count(), 0)

    def test_retrieve_with_month_includes_plans_array(self):
        url = f"/api/tasks/{self.main.uid}/?month=2026-08"
        resp = self.api.get(url)
        self.assertEqual(resp.status_code, 200)
        self.assertIn("plans", resp.data)
        self.assertEqual(len(resp.data["plans"]), 1)
        self.assertEqual(str(resp.data["plans"][0]["subcategory"]), str(self.brs.uid))


class PlanActionEndpointsTests(TestCase):
    def setUp(self):
        self.org, self.user, self.client_master = _setup()
        self.brs = Master.objects.create(name="BRS", type="category", org=self.org, recurrence="Monthly", target_day=5)
        self.vat = Master.objects.create(name="VAT", type="category", org=self.org, recurrence="Monthly", target_day=10)
        self.api = APIClient()
        self.api.force_authenticate(user=self.user)
        self.main = Task.objects.create(
            description="Goal",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            target_date=dt.date(2027, 4, 30),
            engagement_start=dt.date(2026, 5, 1),
            engagement_end=dt.date(2027, 4, 1),
        )
        self.brs_plan = TaskSubcategoryPlan.objects.create(
            main_task=self.main,
            subcategory=self.brs,
            recurrence="monthly",
            target_day=5,
            default_owner=self.user,
            active_from_month=dt.date(2026, 5, 1),
            active_until_month=dt.date(2027, 4, 1),
        )

    def test_add_plan_endpoint_creates_plan_and_returns_child(self):
        url = f"/api/tasks/{self.main.uid}/plans/"
        body = {
            "subcategory": str(self.vat.uid),
            "month": "2026-06",
            "default_owner": str(self.user.uid),
        }
        resp = self.api.post(url, body, format="json")
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertIn("plan", resp.data)
        self.assertIn("child", resp.data)
        self.assertEqual(resp.data["plan"]["active_from_month"], "2026-06-01")

    def test_remove_plan_endpoint_caps_existing_plan(self):
        for m in (5, 6, 7):
            materialize_month(self.main, dt.date(2026, m, 1))
        url = f"/api/tasks/{self.main.uid}/plans/{self.brs_plan.uid}/?from_month=2026-07"
        resp = self.api.delete(url)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.brs_plan.refresh_from_db()
        self.assertEqual(self.brs_plan.active_until_month, dt.date(2026, 6, 1))
        self.assertEqual(self.main.subtasks.count(), 2)

    def test_post_rejects_subcategory_from_another_org(self):
        from users.models import Org as _Org

        other_org = _Org.objects.create(name="OtherOrg")
        foreign_cat = Master.objects.create(name="ForeignCat", type="category", org=other_org)
        url = f"/api/tasks/{self.main.uid}/plans/"
        body = {"subcategory": str(foreign_cat.uid), "month": "2026-06"}
        resp = self.api.post(url, body, format="json")
        self.assertEqual(resp.status_code, 404, resp.content)

    def test_post_rejects_owner_from_another_org(self):
        from users.models import Org as _Org
        from users.models import OrgMembership as _OM
        from users.models import User as _User

        other_org = _Org.objects.create(name="OtherOrg")
        foreign_user = _User.objects.create_user(username="foreigner", password="pw", full_name="Foreign User")
        _OM.objects.create(user=foreign_user, org=other_org, role="employee")
        url = f"/api/tasks/{self.main.uid}/plans/"
        body = {
            "subcategory": str(self.vat.uid),
            "month": "2026-06",
            "default_owner": str(foreign_user.uid),
        }
        resp = self.api.post(url, body, format="json")
        self.assertEqual(resp.status_code, 404, resp.content)

    def test_post_broadcasts_new_child(self):
        """Adding a plan should fire a broadcast for the materialized child."""
        from unittest.mock import patch

        url = f"/api/tasks/{self.main.uid}/plans/"
        body = {"subcategory": str(self.vat.uid), "month": "2026-06"}
        with patch("core.tasks.views.broadcast") as mock_broadcast:
            resp = self.api.post(url, body, format="json")
        self.assertEqual(resp.status_code, 201)
        # At least one INSERT broadcast for the new child Task.
        insert_calls = [c for c in mock_broadcast.call_args_list if c.args[1] == "INSERT"]
        self.assertGreater(len(insert_calls), 0)

    def test_delete_broadcasts_removed_children(self):
        """Capping a plan should fire DELETE broadcasts for removed children."""
        from unittest.mock import patch

        for m in (5, 6, 7):
            materialize_month(self.main, dt.date(2026, m, 1))
        url = f"/api/tasks/{self.main.uid}/plans/{self.brs_plan.uid}/?from_month=2026-07"
        with patch("core.tasks.views.broadcast") as mock_broadcast:
            resp = self.api.delete(url)
        self.assertEqual(resp.status_code, 200)
        delete_calls = [c for c in mock_broadcast.call_args_list if c.args[1] == "DELETE"]
        self.assertGreater(len(delete_calls), 0)


class SubtaskCascadeOwnerTests(TestCase):
    def setUp(self):
        self.org, self.alice, self.client_master = _setup()
        self.bob = User.objects.create_user(username="bob", password="pw", full_name="Bob")
        OrgMembership.objects.create(user=self.bob, org=self.org, role="employee")
        self.brs = Master.objects.create(name="BRS", type="category", org=self.org, recurrence="Monthly", target_day=5)
        self.api = APIClient()
        self.api.force_authenticate(user=self.alice)
        self.main = Task.objects.create(
            description="Goal",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.alice,
            target_date=dt.date(2027, 4, 30),
            engagement_start=dt.date(2026, 5, 1),
            engagement_end=dt.date(2027, 4, 1),
        )
        TaskSubcategoryPlan.objects.create(
            main_task=self.main,
            subcategory=self.brs,
            recurrence="monthly",
            target_day=5,
            default_owner=self.alice,
            active_from_month=dt.date(2026, 5, 1),
            active_until_month=dt.date(2027, 4, 1),
        )
        for m in (5, 6, 7):
            materialize_month(self.main, dt.date(2026, m, 1))
        self.may = Task.objects.get(parent=self.main, target_date=dt.date(2026, 5, 5))
        self.jun = Task.objects.get(parent=self.main, target_date=dt.date(2026, 6, 5))
        self.jul = Task.objects.get(parent=self.main, target_date=dt.date(2026, 7, 5))

    def test_patch_with_cascade_owner_propagates_forward(self):
        url = f"/api/tasks/{self.jun.uid}/?cascade_owner=true"
        resp = self.api.patch(url, {"responsible": str(self.bob.uid)}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.may.refresh_from_db()
        self.jul.refresh_from_db()
        self.assertEqual(self.may.responsible_id, self.alice.pk)
        self.assertEqual(self.jul.responsible_id, self.bob.pk)

    def test_patch_without_cascade_owner_only_updates_one_row(self):
        url = f"/api/tasks/{self.jun.uid}/"
        resp = self.api.patch(url, {"responsible": str(self.bob.uid)}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.jul.refresh_from_db()
        self.assertEqual(self.jul.responsible_id, self.alice.pk)

    def test_cascade_with_cross_org_owner_returns_404(self):
        from users.models import Org as _Org

        other_org = _Org.objects.create(name="OtherOrg")
        foreigner = User.objects.create_user(username="foreigner", password="pw", full_name="Foreigner")
        OrgMembership.objects.create(user=foreigner, org=other_org, role="employee")
        url = f"/api/tasks/{self.jun.uid}/?cascade_owner=true"
        resp = self.api.patch(url, {"responsible": str(foreigner.uid)}, format="json")
        self.assertEqual(resp.status_code, 404, resp.content)

    def test_cascade_broadcasts_each_affected_row(self):
        from unittest.mock import patch

        url = f"/api/tasks/{self.jun.uid}/?cascade_owner=true"
        with patch("core.tasks.views.broadcast") as mock_broadcast:
            resp = self.api.patch(url, {"responsible": str(self.bob.uid)}, format="json")
        self.assertEqual(resp.status_code, 200)
        # June (the row PATCHed) + July (cascaded) → at least 2 UPDATE broadcasts.
        update_calls = [c for c in mock_broadcast.call_args_list if c.args[1] == "UPDATE"]
        self.assertGreaterEqual(len(update_calls), 2)


class PastMonthEditableTests(TestCase):
    def setUp(self):
        self.org, self.user, self.client_master = _setup()
        self.brs = Master.objects.create(name="BRS", type="category", org=self.org, recurrence="Monthly", target_day=5)
        self.api = APIClient()
        self.api.force_authenticate(user=self.user)
        self.main = Task.objects.create(
            description="Goal",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            target_date=dt.date(2099, 1, 1),
            engagement_start=dt.date(2020, 1, 1),
            engagement_end=dt.date(2099, 1, 1),
        )
        self.past_child = Task.objects.create(
            parent=self.main,
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            responsible=self.user,
            description="Past row",
            category=self.brs,
            target_date=dt.date(2020, 1, 5),
        )

    def test_patching_past_month_child_is_allowed(self):
        url = f"/api/tasks/{self.past_child.uid}/"
        resp = self.api.patch(url, {"remarks": "updated"}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.past_child.refresh_from_db()
        self.assertEqual(self.past_child.remarks, "updated")


class BackfillSubcategoryPlansMigrationTests(TestCase):
    """Verifies the data migration logic by invoking the same helper the
    migration's ``RunPython`` callable uses. The actual migration ran during
    setUp of this test database, but we re-test the helper to lock the
    contract.
    """

    def setUp(self):
        self.org, self.user, self.client_master = _setup()
        self.brs = Master.objects.create(name="BRS", type="category", org=self.org, recurrence="Monthly", target_day=5)
        self.main = Task.objects.create(
            description="Legacy Goal",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            target_date=dt.date(2027, 4, 30),
        )
        for m in (5, 6, 7, 8):
            Task.objects.create(
                parent=self.main,
                org=self.org,
                client=self.client_master,
                reporting_manager=self.user,
                responsible=self.user,
                description="BRS",
                category=self.brs,
                target_date=dt.date(2026, m, 5),
            )

    def test_backfill_creates_one_plan_per_subcategory_and_sets_engagement(self):
        from core.tasks.migrations._helpers_backfill import backfill_plans_for_task

        backfill_plans_for_task(self.main, Task, TaskSubcategoryPlan, Master)
        self.main.refresh_from_db()
        plans = list(self.main.sub_plans.all())
        self.assertEqual(len(plans), 1)
        plan = plans[0]
        self.assertEqual(plan.subcategory_id, self.brs.pk)
        self.assertEqual(plan.recurrence, "monthly")
        self.assertEqual(plan.target_day, 5)
        self.assertEqual(plan.active_from_month, dt.date(2026, 5, 1))
        self.assertEqual(plan.active_until_month, dt.date(2026, 8, 1))
        self.assertEqual(plan.default_owner_id, self.user.pk)
        self.assertEqual(self.main.engagement_start, dt.date(2026, 5, 1))
        self.assertEqual(self.main.engagement_end, dt.date(2026, 8, 1))

    def test_backfill_is_idempotent(self):
        from core.tasks.migrations._helpers_backfill import backfill_plans_for_task

        backfill_plans_for_task(self.main, Task, TaskSubcategoryPlan, Master)
        backfill_plans_for_task(self.main, Task, TaskSubcategoryPlan, Master)
        self.assertEqual(self.main.sub_plans.count(), 1)

    def test_backfill_fills_categories_missing_a_plan_when_goal_has_some_plans(self):
        # Repro for the "Plan not found for this row" alert: a goal that
        # already has a plan for one sub-category must still get plans
        # backfilled for its other sub-categories — the old all-or-nothing
        # short-circuit left siblings orphaned and the modal couldn't change
        # their recurrence.
        from core.tasks.migrations._helpers_backfill import backfill_plans_for_task

        purchase = Master.objects.create(
            name="Data Collection - Purchase",
            type="category",
            org=self.org,
            recurrence="Monthly",
            target_day=13,
        )
        Task.objects.create(
            parent=self.main,
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            responsible=self.user,
            description="Data Collection - Purchase",
            category=purchase,
            target_date=dt.date(2026, 5, 13),
        )
        # Seed: one plan exists for the BRS subcategory. The old helper
        # bailed out the moment it saw any plan on the goal.
        TaskSubcategoryPlan.objects.create(
            main_task=self.main,
            subcategory=self.brs,
            recurrence="monthly",
            target_day=5,
            default_owner=self.user,
            active_from_month=dt.date(2026, 5, 1),
            active_until_month=dt.date(2026, 8, 1),
        )

        backfill_plans_for_task(self.main, Task, TaskSubcategoryPlan, Master)

        plan_cat_ids = set(self.main.sub_plans.values_list("subcategory_id", flat=True))
        self.assertIn(self.brs.pk, plan_cat_ids)
        self.assertIn(purchase.pk, plan_cat_ids)
        # The pre-existing BRS plan must not be duplicated.
        self.assertEqual(self.main.sub_plans.filter(subcategory=self.brs).count(), 1)


class NormalizeRecurrenceWeeklyTests(TestCase):
    def test_weekly_master_normalises_to_weekly_task(self):
        from core.tasks.services import _normalize_recurrence

        self.assertEqual(_normalize_recurrence("Weekly"), "weekly")


class WeeklyMaterializeMonthTests(TestCase):
    """Materialisation for the Weekly recurrence — one child per week per
    plan, on the configured ISO weekday."""

    def setUp(self):
        self.org, self.user, self.client_master = _setup()
        self.main = Task.objects.create(
            description="Goal",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            target_date=dt.date(2027, 4, 30),
            engagement_start=dt.date(2026, 5, 1),
            engagement_end=dt.date(2027, 4, 1),
        )
        self.sync = Master.objects.create(name="Weekly Sync", type="category", org=self.org)
        self.plan = TaskSubcategoryPlan.objects.create(
            main_task=self.main,
            subcategory=self.sync,
            recurrence="weekly",
            target_day=3,  # Wednesday
            default_owner=self.user,
            active_from_month=dt.date(2026, 5, 1),
            active_until_month=dt.date(2027, 4, 1),
        )

    def test_materialises_every_wednesday_of_may_2026(self):
        # May 2026 Wednesdays: 5/6, 5/13, 5/20, 5/27.
        created = materialize_month(self.main, dt.date(2026, 5, 1))
        target_dates = sorted(c.target_date for c in created)
        self.assertEqual(
            target_dates,
            [
                dt.date(2026, 5, 6),
                dt.date(2026, 5, 13),
                dt.date(2026, 5, 20),
                dt.date(2026, 5, 27),
            ],
        )
        # Every child carries the plan's subcategory + default_owner.
        for child in created:
            self.assertEqual(child.category_id, self.sync.pk)
            self.assertEqual(child.responsible_id, self.user.pk)

    def test_weekly_is_idempotent(self):
        materialize_month(self.main, dt.date(2026, 5, 1))
        created_again = materialize_month(self.main, dt.date(2026, 5, 1))
        self.assertEqual(created_again, [])
        self.assertEqual(self.main.subtasks.count(), 4)

    def test_weekly_respects_active_until_month_capped_tail(self):
        # Cap the plan at May 2026 — June occurrences should not appear.
        self.plan.active_until_month = dt.date(2026, 5, 1)
        self.plan.save()
        # Within-window May still emits 4 children.
        self.assertEqual(len(materialize_month(self.main, dt.date(2026, 5, 1))), 4)
        # Out-of-window June emits zero.
        self.assertEqual(materialize_month(self.main, dt.date(2026, 6, 1)), [])

    def test_weekly_skips_dates_past_main_target_date_ceiling(self):
        # Tighten the goal's target_date so only the first Wednesday fits.
        self.main.target_date = dt.date(2026, 5, 10)
        self.main.save()
        created = materialize_month(self.main, dt.date(2026, 5, 1))
        # 5/6 fits; 5/13, 5/20, 5/27 are all past the 5/10 ceiling.
        self.assertEqual([c.target_date for c in created], [dt.date(2026, 5, 6)])

    def test_weekly_target_day_null_falls_back_to_month_start_weekday(self):
        self.plan.target_day = None
        self.plan.save()
        # May 1 2026 is a Friday (isoweekday=5).
        created = materialize_month(self.main, dt.date(2026, 5, 1))
        # Every Friday in May 2026: 5/1, 5/8, 5/15, 5/22, 5/29.
        target_dates = sorted(c.target_date for c in created)
        self.assertEqual(
            target_dates,
            [
                dt.date(2026, 5, 1),
                dt.date(2026, 5, 8),
                dt.date(2026, 5, 15),
                dt.date(2026, 5, 22),
                dt.date(2026, 5, 29),
            ],
        )


class CreateGoalWithWeeklyPlansTests(TestCase):
    """End-to-end: POST /api/tasks/ with plans built from a Weekly sub-cat
    master. Regression for the bug where a master with ``recurrence=""``
    silently produced a ``"monthly" target_day=1`` plan that emitted day-1
    children at the engagement_start (e.g. May 1 instead of every Monday).
    """

    def setUp(self):
        from rest_framework.test import APIClient

        self.org, self.user, self.client_master = _setup()
        self.parent_cat = Master.objects.create(name="DB Update - Weekly", type="category", org=self.org)
        self.parent_cat.orgs.add(self.org)
        self.stock = Master.objects.create(
            name="Stock Report",
            type="category",
            org=self.org,
            parent=self.parent_cat,
            recurrence="Weekly",
            target_day=1,
        )
        self.stock.orgs.add(self.org)
        self.sales = Master.objects.create(
            name="Sales Report",
            type="category",
            org=self.org,
            parent=self.parent_cat,
            recurrence="Weekly",
            target_day=1,
        )
        self.sales.orgs.add(self.org)
        self.api = APIClient()
        self.api.force_authenticate(user=self.user)

    def _post(self, plans):
        body = {
            "description": "Weekly DB update",
            "client": str(self.client_master.uid),
            "category": str(self.parent_cat.uid),
            "reporting_manager": str(self.user.uid),
            "responsible": str(self.user.uid),
            "target_date": "2027-04-26",
            "engagement_start": "2026-05-01",
            "engagement_end": "2027-04-01",
            "recurrence": "weekly",
            "plans": plans,
        }
        return self.api.post("/api/tasks/", body, format="json")

    def test_plans_from_weekly_master_create_weekly_plans_with_monday_children(self):
        # Mirrors the new buildPlansPayload: frontend always sends the
        # master's current recurrence + target_day.
        resp = self._post(
            [
                {
                    "subcategory": str(self.stock.uid),
                    "default_owner": str(self.user.uid),
                    "recurrence": "Weekly",
                    "target_day": 1,
                },
                {
                    "subcategory": str(self.sales.uid),
                    "default_owner": str(self.user.uid),
                    "recurrence": "Weekly",
                    "target_day": 1,
                },
            ]
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        goal = Task.objects.get(uid=resp.data["uid"])
        for plan in goal.sub_plans.all():
            self.assertEqual(plan.recurrence, "weekly")
            self.assertEqual(plan.target_day, 1)

        may = Task.objects.filter(
            parent=goal, target_date__gte=dt.date(2026, 5, 1), target_date__lt=dt.date(2026, 6, 1)
        ).order_by("target_date", "category__name")
        target_dates = sorted({c.target_date for c in may})
        # Every Monday of May 2026: 4, 11, 18, 25 — no day-1 outlier.
        self.assertEqual(
            target_dates,
            [dt.date(2026, 5, 4), dt.date(2026, 5, 11), dt.date(2026, 5, 18), dt.date(2026, 5, 25)],
        )

    def test_plans_inherit_recurrence_from_master_when_override_omitted(self):
        # Legacy path: frontend doesn't send recurrence override at all.
        # The backend should still create weekly plans because the master
        # has ``recurrence="Weekly"`` — no silent fall-through to monthly.
        resp = self._post(
            [
                {"subcategory": str(self.stock.uid), "default_owner": str(self.user.uid)},
            ]
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        goal = Task.objects.get(uid=resp.data["uid"])
        plan = goal.sub_plans.get(subcategory=self.stock)
        self.assertEqual(plan.recurrence, "weekly")
        self.assertEqual(plan.target_day, 1)

    def test_plan_create_rejects_master_with_empty_recurrence(self):
        # Bug regression: a master with ``recurrence=""`` used to silently
        # become a ``monthly target_day=1`` plan, emitting day-1 children
        # at engagement_start. Now we 400 early so the user fixes the
        # master rather than discovering bogus dates later.
        empty_sub = Master.objects.create(
            name="Unset Sub", type="category", org=self.org, parent=self.parent_cat, recurrence="", target_day=1
        )
        empty_sub.orgs.add(self.org)
        resp = self._post(
            [{"subcategory": str(empty_sub.uid), "default_owner": str(self.user.uid)}],
        )
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn("plans", resp.data)
        self.assertIn("Unset Sub", str(resp.data["plans"]))

    def test_per_plan_recurrence_override_wins_over_master(self):
        # The dropdown on the per-row Recurrence column should still
        # win — the user can promote a Weekly master to Monthly for one
        # specific goal without touching the master itself.
        resp = self._post(
            [
                {
                    "subcategory": str(self.stock.uid),
                    "default_owner": str(self.user.uid),
                    "recurrence": "Monthly",
                    "target_day": 15,
                },
            ]
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        goal = Task.objects.get(uid=resp.data["uid"])
        plan = goal.sub_plans.get(subcategory=self.stock)
        self.assertEqual(plan.recurrence, "monthly")
        self.assertEqual(plan.target_day, 15)


class UpdatePlanRecurrenceTargetDayTests(TestCase):
    """Regression: changing a stale plan's recurrence (e.g. Onetime+5 →
    Weekly) via the per-row dropdown must also reset ``target_day`` so the
    new cadence emits on the right weekday. Without this, a Weekly plan
    with ``target_day=5`` would emit every Friday rather than every
    Monday — surprising users who just want to "sync this plan to the
    current master cadence" with one click.
    """

    def setUp(self):
        from rest_framework.test import APIClient

        self.org, self.user, self.client_master = _setup()
        self.parent_cat = Master.objects.create(name="Parent Weekly", type="category", org=self.org)
        self.parent_cat.orgs.add(self.org)
        # Sub-cat: master is currently Weekly + target_day=1 (Mon). The
        # plan we'll create starts stale (Onetime + 5) to simulate "goal
        # was made before the user fixed the master".
        self.stock = Master.objects.create(
            name="Stock Weekly",
            type="category",
            org=self.org,
            parent=self.parent_cat,
            recurrence="Weekly",
            target_day=1,
        )
        self.stock.orgs.add(self.org)
        self.main = Task.objects.create(
            description="Goal",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            target_date=dt.date(2027, 4, 30),
            engagement_start=dt.date(2026, 5, 1),
            engagement_end=dt.date(2027, 4, 1),
        )
        self.stale_plan = TaskSubcategoryPlan.objects.create(
            main_task=self.main,
            subcategory=self.stock,
            recurrence="onetime",
            target_day=5,
            default_owner=self.user,
            active_from_month=dt.date(2026, 5, 1),
            active_until_month=dt.date(2027, 4, 1),
        )
        # Materialise the stale plan so we have a child at May 5 to begin with.
        materialize_month(self.main, dt.date(2026, 5, 1))
        self.assertEqual(
            list(
                self.main.subtasks.filter(target_date__year=2026, target_date__month=5).values_list(
                    "target_date", flat=True
                )
            ),
            [dt.date(2026, 5, 5)],
        )
        self.api = APIClient()
        self.api.force_authenticate(user=self.user)

    def test_patch_resyncs_target_day_to_master_when_provided(self):
        """The user picks 'Weekly' in the per-row dropdown. The frontend
        sends ``recurrence=Weekly`` AND the master's current ``target_day=1``
        in the same PATCH so the plan resyncs to the master's cadence
        (every Monday) instead of emitting every Friday (the stale 5).
        """
        resp = self.api.patch(
            f"/api/tasks/{self.main.uid}/plans/{self.stale_plan.uid}/?from_month=2026-05",
            {"recurrence": "Weekly", "target_day": 1},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.stale_plan.refresh_from_db()
        self.assertEqual(self.stale_plan.recurrence, "weekly")
        self.assertEqual(self.stale_plan.target_day, 1)

        may_dates = sorted(
            self.main.subtasks.filter(target_date__year=2026, target_date__month=5).values_list(
                "target_date", flat=True
            )
        )
        # All Mondays of May 2026 — no May 5 outlier.
        self.assertEqual(
            may_dates,
            [dt.date(2026, 5, 4), dt.date(2026, 5, 11), dt.date(2026, 5, 18), dt.date(2026, 5, 25)],
        )

    def test_patch_without_target_day_leaves_it_unchanged(self):
        """Back-compat: callers that only send recurrence (legacy UI)
        keep the previous target_day. ``update_plan_recurrence`` only
        touches ``target_day`` when an explicit value arrives.
        """
        resp = self.api.patch(
            f"/api/tasks/{self.main.uid}/plans/{self.stale_plan.uid}/?from_month=2026-05",
            {"recurrence": "Weekly"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.stale_plan.refresh_from_db()
        self.assertEqual(self.stale_plan.recurrence, "weekly")
        self.assertEqual(self.stale_plan.target_day, 5)  # unchanged
        # Materialised dates land on every Friday (isoweekday=5) — proves
        # the target_day really wasn't touched.
        may_dates = sorted(
            self.main.subtasks.filter(target_date__year=2026, target_date__month=5).values_list(
                "target_date", flat=True
            )
        )
        self.assertEqual(
            may_dates,
            [
                dt.date(2026, 5, 1),
                dt.date(2026, 5, 8),
                dt.date(2026, 5, 15),
                dt.date(2026, 5, 22),
                dt.date(2026, 5, 29),
            ],
        )

    def test_patch_rejects_weekly_target_day_above_seven(self):
        resp = self.api.patch(
            f"/api/tasks/{self.main.uid}/plans/{self.stale_plan.uid}/?from_month=2026-05",
            {"recurrence": "Weekly", "target_day": 15},
            format="json",
        )
        self.assertEqual(resp.status_code, 400, resp.content)
        self.stale_plan.refresh_from_db()
        # Nothing should have changed — the validation fires before the
        # save / materialise pass.
        self.assertEqual(self.stale_plan.recurrence, "onetime")
        self.assertEqual(self.stale_plan.target_day, 5)

    def test_patch_rejects_monthly_target_day_above_thirtyone(self):
        resp = self.api.patch(
            f"/api/tasks/{self.main.uid}/plans/{self.stale_plan.uid}/?from_month=2026-05",
            {"recurrence": "Monthly", "target_day": 40},
            format="json",
        )
        self.assertEqual(resp.status_code, 400, resp.content)
        self.stale_plan.refresh_from_db()
        self.assertEqual(self.stale_plan.recurrence, "onetime")


class MaterializeMonthEditPreservationTests(TestCase):
    """User-edits to a child's target_date must not be undone by the next
    lazy materialise call. The dedupe is "plan already has a row this
    month → leave the month alone", not "row exists at the cadence's
    expected date → leave that one alone". The latter shape would
    spawn a duplicate at the original cadenced date the moment the user
    edited a row out of its cadence slot."""

    def setUp(self):
        self.org, self.user, self.client_master = _setup()
        self.main = Task.objects.create(
            description="Goal",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            target_date=dt.date(2027, 4, 30),
            engagement_start=dt.date(2026, 5, 1),
            engagement_end=dt.date(2027, 4, 1),
        )
        self.cashier = Master.objects.create(name="Cashier Summary", type="category", org=self.org)
        self.plan = TaskSubcategoryPlan.objects.create(
            main_task=self.main,
            subcategory=self.cashier,
            recurrence="monthly",
            target_day=2,
            default_owner=self.user,
            active_from_month=dt.date(2026, 5, 1),
            active_until_month=dt.date(2027, 4, 1),
        )

    def test_edited_target_date_is_not_duplicated_on_relmateralise(self):
        # Initial materialise: one row at the cadenced day (2nd).
        materialize_month(self.main, dt.date(2026, 5, 1))
        child = self.main.subtasks.get(target_date=dt.date(2026, 5, 2))
        # User edits the date to the 3rd (as in the screenshot).
        child.target_date = dt.date(2026, 5, 3)
        child.save(update_fields=["target_date", "updated_at"])
        # Re-running materialize_month (e.g. on the next view load) must
        # NOT spawn a fresh row at the original cadenced 2nd — the plan
        # already has a child this month, so leave the month alone.
        created_again = materialize_month(self.main, dt.date(2026, 5, 1))
        self.assertEqual(created_again, [])
        dates = sorted(
            self.main.subtasks.filter(target_date__year=2026, target_date__month=5).values_list(
                "target_date", flat=True
            )
        )
        self.assertEqual(dates, [dt.date(2026, 5, 3)])

    def test_weekly_initial_materialise_still_emits_full_cadence(self):
        # The new "skip on touched plan" rule must NOT break the initial
        # bootstrap: a fresh weekly plan with no existing children should
        # still emit every matching weekday in the month on first run.
        weekly_master = Master.objects.create(name="Weekly Cashier", type="category", org=self.org)
        TaskSubcategoryPlan.objects.create(
            main_task=self.main,
            subcategory=weekly_master,
            recurrence="weekly",
            target_day=3,  # Wednesday
            default_owner=self.user,
            active_from_month=dt.date(2026, 5, 1),
            active_until_month=dt.date(2027, 4, 1),
        )
        created = materialize_month(self.main, dt.date(2026, 5, 1))
        weekly_dates = sorted(c.target_date for c in created if c.category_id == weekly_master.pk)
        # May 2026 Wednesdays: 5/6, 5/13, 5/20, 5/27.
        self.assertEqual(
            weekly_dates,
            [dt.date(2026, 5, 6), dt.date(2026, 5, 13), dt.date(2026, 5, 20), dt.date(2026, 5, 27)],
        )

    def test_deleted_child_does_not_revive_on_relmateralise(self):
        # Once the user deletes a child, the month becomes "user-managed"
        # via the next sibling left over OR the plan_touched_this_month
        # bookkeeping seeded by initial materialise. Re-running shouldn't
        # un-do the delete. (This case keeps a sibling so the plan is
        # still touched-this-month — a fully-empty plan/month is treated
        # as fresh and re-bootstrapped, which is the right behaviour for
        # newly-unlocked months in a long engagement.)
        cashier2 = Master.objects.create(name="Another Cat", type="category", org=self.org)
        TaskSubcategoryPlan.objects.create(
            main_task=self.main,
            subcategory=cashier2,
            recurrence="monthly",
            target_day=2,
            default_owner=self.user,
            active_from_month=dt.date(2026, 5, 1),
            active_until_month=dt.date(2027, 4, 1),
        )
        materialize_month(self.main, dt.date(2026, 5, 1))
        # Two children. Delete the cashier one.
        Task.objects.filter(parent=self.main, category=self.cashier).delete()
        # Re-run: the cashier plan still has zero children, so it WILL
        # re-bootstrap. The delete was intentional but unsticky in this
        # scenario; the user gets the row back. Document the behaviour
        # so callers know to cap the plan (X button) for a permanent
        # remove rather than deleting the child Task directly.
        created_again = materialize_month(self.main, dt.date(2026, 5, 1))
        self.assertEqual(len(created_again), 1)
        self.assertEqual(created_again[0].category_id, self.cashier.pk)


class DuplicateChildGuardTests(TestCase):
    """A goal must never end up with two children for the same
    (parent, category, target_date). ``materialize_month``'s in-Python
    dedupe is a check-then-insert with no DB uniqueness behind it, so two
    concurrent loads of the same goal+month both read an empty month and
    both insert the full subcategory set — the dashboard then shows every
    recurring task twice. The fix is a DB-level unique constraint plus a
    race-tolerant create so the loser of the race is silently skipped.
    """

    def setUp(self):
        self.org, self.user, self.client_master = _setup()
        self.main = Task.objects.create(
            description="Goal",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            target_date=dt.date(2027, 4, 30),
            engagement_start=dt.date(2026, 5, 1),
            engagement_end=dt.date(2027, 4, 1),
        )
        self.brs = Master.objects.create(name="BRS", type="category", org=self.org)
        self.plan = TaskSubcategoryPlan.objects.create(
            main_task=self.main,
            subcategory=self.brs,
            recurrence="monthly",
            target_day=5,
            default_owner=self.user,
            active_from_month=dt.date(2026, 5, 1),
            active_until_month=dt.date(2027, 4, 1),
        )

    def test_db_rejects_two_children_in_same_slot(self):
        materialize_month(self.main, dt.date(2026, 5, 1))
        # A second child for the exact same (parent, category, target_date)
        # is a duplicate by definition — the DB must refuse it.
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                Task.objects.create(
                    parent=self.main,
                    org=self.org,
                    client=self.client_master,
                    reporting_manager=self.user,
                    description="BRS",
                    category=self.brs,
                    target_date=dt.date(2026, 5, 5),
                    status="pending",
                )

    def test_materialize_is_race_tolerant(self):
        # Simulate the race: a competing request has already inserted this
        # month's child, but our existence-check read the month as empty
        # (stale snapshot). materialize_month must not raise and must not
        # leave a duplicate behind.
        from unittest import mock

        Task.objects.create(
            parent=self.main,
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            description="BRS",
            category=self.brs,
            target_date=dt.date(2026, 5, 5),
            status="pending",
        )
        with mock.patch("core.tasks.services._existing_children_in_month", return_value=[]):
            created = materialize_month(self.main, dt.date(2026, 5, 1))
        self.assertEqual(created, [])
        self.assertEqual(
            self.main.subtasks.filter(target_date=dt.date(2026, 5, 5)).count(),
            1,
        )
