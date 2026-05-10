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
