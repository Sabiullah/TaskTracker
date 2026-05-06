import datetime as dt

from django.core.exceptions import ValidationError
from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

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
        self.org, self.user, self.client = _setup()
        self.main = Task.objects.create(
            description="Main",
            org=self.org,
            client=self.client,
            reporting_manager=self.user,
            target_date=dt.date(2026, 6, 1),
        )

    def test_sub_target_date_after_parent_target_is_rejected(self):
        sub = Task(
            description="Sub",
            org=self.org,
            client=self.client,
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
            client=self.client,
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
            client=self.client,
            reporting_manager=self.user,
            responsible=self.user,
            parent=self.main,
        )
        grand = Task(
            description="Grand",
            org=self.org,
            client=self.client,
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
            client=self.client,
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
