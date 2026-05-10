import datetime as dt

from django.core.exceptions import ValidationError
from django.test import TestCase
from rest_framework.test import APIClient, APIRequestFactory, force_authenticate

from core.masters.models import Master
from core.tasks.models import Task
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

    def test_create_rejects_sub_target_after_main_target(self):
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
        with self.assertRaises(ValidationError) as ctx:
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


from core.tasks.models import TaskSubcategoryPlan


class TaskSubcategoryPlanModelTests(TestCase):
    def setUp(self):
        self.org, self.user, _client = _setup()
        self.main = Task.objects.create(
            description="Goal",
            org=self.org,
            reporting_manager=self.user,
            target_date=dt.date(2027, 4, 30),
        )
        self.sub_cat = Master.objects.create(
            name="BRS", type="category", org=self.org
        )

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
        with self.assertRaises(Exception):  # IntegrityError
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


from core.tasks.services import materialize_month


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

    def test_raises_validation_when_plan_extends_past_main_target(self):
        from django.core.exceptions import ValidationError
        # Set the plan's active window to extend past main.target_date.
        # main.target_date = 2027-04-30. Materialize for May 2027 — would
        # create a child with target_date 2027-05-05, past the parent's deadline.
        self.plan.active_until_month = dt.date(2027, 5, 1)
        self.plan.save()
        with self.assertRaises(ValidationError):
            materialize_month(self.main, dt.date(2027, 5, 1))
        # Nothing should have been created (atomic transaction rolled back).
        self.assertEqual(self.main.subtasks.count(), 0)


from core.tasks.services import cascade_owner_forward


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
        vat_jun = Task.objects.get(
            parent=self.main, category=other_cat, target_date=dt.date(2026, 6, 10)
        )
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
        """Cascading the last materialized child returns 1 (just the child)."""
        rows = cascade_owner_forward(self.jul, new_owner=self.bob)
        self.assertEqual(rows, 1)


from core.tasks.services import add_or_extend_plan, cap_plan


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
        plan, child = add_or_extend_plan(
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
        self.assertIsNotNone(child)
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
        plan2, _child = add_or_extend_plan(
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
        plan2, _ = add_or_extend_plan(
            self.main, self.brs, month_start=dt.date(2026, 8, 1), owner=self.user
        )
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
        remaining = sorted(
            Task.objects.filter(parent=self.main).values_list("target_date", flat=True)
        )
        self.assertEqual(remaining, [dt.date(2026, 5, 5), dt.date(2026, 6, 5)])
        self.assertEqual(result["plan_capped"], True)
        self.assertEqual(result["children_deleted"], 2)

    def test_keeps_completed_children_even_when_capped(self):
        jul = Task.objects.get(parent=self.main, target_date=dt.date(2026, 7, 5))
        jul.completed_date = dt.date(2026, 7, 4)
        jul.status = "completed"
        jul.save()

        cap_plan(self.plan, from_month=dt.date(2026, 7, 1))

        remaining = sorted(
            Task.objects.filter(parent=self.main).values_list("target_date", flat=True)
        )
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
        Task.objects.filter(
            parent=self.main, target_date__gte=dt.date(2026, 9, 1)
        ).delete()
        result = cap_plan(self.plan, from_month=dt.date(2026, 12, 1))
        self.plan.refresh_from_db()
        self.assertEqual(self.plan.active_until_month, dt.date(2026, 8, 1))
        # No children should be deleted (none past Aug to begin with).
        self.assertEqual(result["children_deleted"], 0)
        # Still treat as a "cap" (no plan_deleted), even though it was a no-op.
        self.assertTrue(result["plan_capped"])
